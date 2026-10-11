// Input/output guardrails using Meta's Prompt Guard (jailbreak / prompt
// injection classifier, hosted on Groq) and Llama Guard (content safety
// classifier, run locally with Ollama).

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

const PROMPT_GUARD_MODEL =
  process.env.PROMPT_GUARD_MODEL ?? "meta-llama/llama-prompt-guard-2-86m";
const LLAMA_GUARD_MODEL = process.env.LLAMA_GUARD_MODEL ?? "llama-guard3:8b";

// Probability above which Prompt Guard's "malicious" score blocks a prompt.
const PROMPT_GUARD_THRESHOLD = Number(
  process.env.PROMPT_GUARD_THRESHOLD ?? "0.5",
);

// What to do when a guard model can't be reached (missing key, Ollama not
// running, provider outage). Defaults to letting the request through so a
// guard outage doesn't take the whole app down; set to "true" to block.
const FAIL_CLOSED = process.env.GUARDRAILS_FAIL_CLOSED === "true";

// Prompt Guard 2 reads at most 512 tokens, so longer text is checked in
// slices and the highest score wins. ~2000 chars stays under that limit.
const PROMPT_GUARD_CHUNK_CHARS = 2000;
const PROMPT_GUARD_MAX_CHUNKS = 8;

// Llama Guard only needs recent turns to judge the last one.
const LLAMA_GUARD_MAX_MESSAGES = 6;
const PROMPT_GUARD_TIMEOUT_MS = 10_000;
// Generous because the first Ollama call after it unloads the model has to
// load ~5 GB back into memory.
const LLAMA_GUARD_TIMEOUT_MS = 60_000;
// How long Ollama keeps Llama Guard loaded after the last check.
const LLAMA_GUARD_KEEP_ALIVE = process.env.LLAMA_GUARD_KEEP_ALIVE ?? "30m";

// Llama Guard 3's hazard taxonomy (MLCommons; Llama Guard 4 uses the same).
const HAZARD_CATEGORIES: Record<string, string> = {
  S1: "Violent Crimes",
  S2: "Non-Violent Crimes",
  S3: "Sex-Related Crimes",
  S4: "Child Sexual Exploitation",
  S5: "Defamation",
  S6: "Specialized Advice",
  S7: "Privacy",
  S8: "Intellectual Property",
  S9: "Indiscriminate Weapons",
  S10: "Hate",
  S11: "Suicide & Self-Harm",
  S12: "Sexual Content",
  S13: "Elections",
  S14: "Code Interpreter Abuse",
};

export interface GuardMessage {
  role: "user" | "assistant";
  content: string;
}

export type GuardStage = "input" | "output";

export interface GuardVerdict {
  allowed: boolean;
  // Present when blocked: which check fired and why, for display to the user.
  blocked?: {
    stage: GuardStage;
    guard: "prompt-guard" | "llama-guard" | "unavailable";
    reason: string;
    categories?: string[];
    score?: number;
  };
  // Guard calls that failed and were let through (fail-open).
  errors: string[];
}

export function guardrailsConfigured(): boolean {
  return process.env.GUARDRAILS_ENABLED !== "false";
}

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

// Returns the probability (0-1) that the text is a jailbreak or prompt
// injection attempt. Groq serves Prompt Guard through its chat completions
// API: the reply content is that probability as a string.
async function promptGuardScore(text: string): Promise<number> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const chunks: string[] = [];
  for (
    let i = 0;
    i < text.length && chunks.length < PROMPT_GUARD_MAX_CHUNKS;
    i += PROMPT_GUARD_CHUNK_CHARS
  ) {
    chunks.push(text.slice(i, i + PROMPT_GUARD_CHUNK_CHARS));
  }

  const scores = await Promise.all(
    chunks.map(async (chunk) => {
      const data = (await postJson(
        GROQ_CHAT_URL,
        {
          model: PROMPT_GUARD_MODEL,
          messages: [{ role: "user", content: chunk }],
        },
        PROMPT_GUARD_TIMEOUT_MS,
        { Authorization: `Bearer ${apiKey}` },
      )) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content ?? "";
      const score = Number.parseFloat(content);
      if (!Number.isFinite(score)) {
        throw new Error(
          `Unexpected Prompt Guard output: ${content.slice(0, 100)}`,
        );
      }
      return score;
    }),
  );
  return Math.max(...scores);
}

// Llama Guard classifies the *last* message of the conversation (a user
// prompt for input checks, an assistant reply for output checks). It replies
// "safe", or "unsafe" followed by violated category codes like "S1,S10".
async function llamaGuardCategories(
  messages: GuardMessage[],
): Promise<string[] | null> {
  const recent = messages.slice(-LLAMA_GUARD_MAX_MESSAGES);
  // Llama Guard's chat template requires the conversation to start with a
  // user turn.
  while (recent.length && recent[0].role !== "user") recent.shift();

  // Ollama's native API (rather than its OpenAI-compatible one) so the model
  // can be kept loaded between checks.
  const data = (await postJson(
    `${OLLAMA_URL}/api/chat`,
    {
      model: LLAMA_GUARD_MODEL,
      messages: recent,
      stream: false,
      keep_alive: LLAMA_GUARD_KEEP_ALIVE,
      options: { temperature: 0, num_predict: 20 },
    },
    LLAMA_GUARD_TIMEOUT_MS,
  )) as { message?: { content?: string } };

  const output = (data.message?.content ?? "").trim();
  if (/^safe\b/i.test(output)) return null;
  if (!/^unsafe\b/i.test(output)) {
    throw new Error(`Unexpected Llama Guard output: ${output.slice(0, 100)}`);
  }
  const codes = output.match(/S\d{1,2}/g) ?? [];
  return codes.length ? codes : ["unspecified"];
}

function describeCategories(codes: string[]): string {
  return codes
    .map((c) => (HAZARD_CATEGORIES[c] ? `${c} ${HAZARD_CATEGORIES[c]}` : c))
    .join(", ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unavailable(stage: GuardStage, errors: string[]): GuardVerdict {
  if (!FAIL_CLOSED) return { allowed: true, errors };
  return {
    allowed: false,
    errors,
    blocked: {
      stage,
      guard: "unavailable",
      reason: "Safety checks are unavailable right now, so this was blocked.",
    },
  };
}

// Checks the latest user message: Prompt Guard for jailbreaks / injections
// and Llama Guard for unsafe content, in parallel.
export async function checkInput(
  messages: GuardMessage[],
): Promise<GuardVerdict> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser?.content.trim()) return { allowed: true, errors: [] };

  // Llama Guard should judge the conversation up to and including the
  // latest user message, not anything after it.
  const upToLastUser = messages.slice(0, messages.lastIndexOf(lastUser) + 1);

  const [promptGuard, llamaGuard] = await Promise.allSettled([
    promptGuardScore(lastUser.content),
    llamaGuardCategories(upToLastUser),
  ]);

  const errors: string[] = [];

  if (promptGuard.status === "fulfilled") {
    if (promptGuard.value >= PROMPT_GUARD_THRESHOLD) {
      return {
        allowed: false,
        errors,
        blocked: {
          stage: "input",
          guard: "prompt-guard",
          reason: "Possible jailbreak or prompt injection attempt",
          score: promptGuard.value,
        },
      };
    }
  } else {
    errors.push(`Prompt Guard: ${errorMessage(promptGuard.reason)}`);
  }

  if (llamaGuard.status === "fulfilled") {
    if (llamaGuard.value) {
      return {
        allowed: false,
        errors,
        blocked: {
          stage: "input",
          guard: "llama-guard",
          reason: `Unsafe request (${describeCategories(llamaGuard.value)})`,
          categories: llamaGuard.value,
        },
      };
    }
  } else {
    errors.push(`Llama Guard: ${errorMessage(llamaGuard.reason)}`);
  }

  if (errors.length) {
    console.error("Guardrails input check failed:", errors.join("; "));
    return unavailable("input", errors);
  }
  return { allowed: true, errors };
}

// Checks a model reply in the context of the conversation that produced it.
export async function checkOutput(
  messages: GuardMessage[],
  reply: string,
): Promise<GuardVerdict> {
  if (!reply.trim()) return { allowed: true, errors: [] };
  try {
    const categories = await llamaGuardCategories([
      ...messages,
      { role: "assistant", content: reply },
    ]);
    if (!categories) return { allowed: true, errors: [] };
    return {
      allowed: false,
      errors: [],
      blocked: {
        stage: "output",
        guard: "llama-guard",
        reason: `Unsafe response (${describeCategories(categories)})`,
        categories,
      },
    };
  } catch (error) {
    const message = `Llama Guard: ${errorMessage(error)}`;
    console.error("Guardrails output check failed:", message);
    return unavailable("output", [message]);
  }
}

// Blocked requests return 200 with a `blocked` body and an
// X-Guardrails-Blocked header (even for streaming requests), so the client
// can tell a refusal apart from a normal reply or an error.
export function blockedResponse(
  verdict: GuardVerdict,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { blocked: verdict.blocked },
    {
      headers: {
        ...headers,
        "X-Guardrails-Blocked": verdict.blocked?.stage ?? "input",
      },
    },
  );
}
