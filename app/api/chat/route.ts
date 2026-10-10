import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import {
  getCachedResponse,
  makeCacheKey,
  setCachedResponse,
} from "../../utils/responseCache";
import {
  blockedResponse,
  checkInput,
  checkOutput,
  GuardMessage,
  guardrailsConfigured,
} from "../../utils/guardrails";

export const runtime = "nodejs";

const AVAILABLE_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3.6-flash",
  "gemini-3-pro-image-preview",
];

const REASONING_LEVELS = ["minimal", "low", "medium", "high"];

interface ModelParams {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  seed?: number;
  reasoningLevel?: string;
  stream?: boolean;
  jsonMode?: boolean;
}

// The GenAI SDK throws errors whose `message` is itself a JSON string
// wrapping the upstream API's error body, e.g.
// {"error":{"message":"{\"error\":{\"message\":\"...\",\"code\":503,...}}",...}}
// Unwrap it so the actual reason (rate limit, overload, bad param, etc.)
// reaches the user instead of a generic failure message.
function extractApiErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  let current = raw;
  for (let i = 0; i < 3; i++) {
    try {
      const parsed = JSON.parse(current);
      const nested = parsed?.error?.message;
      if (typeof nested !== "string") break;
      current = nested;
    } catch {
      break;
    }
  }
  return current;
}

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function buildGenerationConfig(params: ModelParams | undefined) {
  const config: Record<string, unknown> = {
    temperature: clamp(params?.temperature, 0, 2, 1),
    topP: clamp(params?.topP, 0, 1, 1),
  };

  // Some models reject the frequency/presence penalty fields outright, even
  // set to their neutral (0) value, so only include them when the user has
  // actually moved the slider away from the default.
  const frequencyPenalty = clamp(params?.frequencyPenalty, -2, 2, 0);
  if (frequencyPenalty !== 0) config.frequencyPenalty = frequencyPenalty;

  const presencePenalty = clamp(params?.presencePenalty, -2, 2, 0);
  if (presencePenalty !== 0) config.presencePenalty = presencePenalty;

  const maxOutputTokens = Number(params?.maxOutputTokens);
  if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
    config.maxOutputTokens = Math.floor(maxOutputTokens);
  }

  const topK = Number(params?.topK);
  if (Number.isFinite(topK) && topK >= 1) {
    config.topK = Math.floor(topK);
  }

  const seed = typeof params?.seed === "number" ? params.seed : NaN;
  if (Number.isFinite(seed)) {
    config.seed = Math.floor(seed);
  }

  if (Array.isArray(params?.stopSequences)) {
    const stopSequences = params.stopSequences
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .slice(0, 5);
    if (stopSequences.length > 0) config.stopSequences = stopSequences;
  }

  if (params?.jsonMode) {
    config.responseMimeType = "application/json";
  }

  if (
    typeof params?.reasoningLevel === "string" &&
    REASONING_LEVELS.includes(params.reasoningLevel)
  ) {
    config.thinkingConfig = { thinkingLevel: params.reasoningLevel };
  }

  return config;
}

export async function POST(request: NextRequest) {
  try {
    const { messages, model, params, skipCache, guardrails } =
      await request.json();
    const selectedModel = AVAILABLE_MODELS.includes(model)
      ? model
      : AVAILABLE_MODELS[0];

    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 },
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // Convert chat messages to Gemini format
    const contents = messages.map((msg: { role: string; content: string }) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    const config = buildGenerationConfig(params);

    // Guardrails run unless the client opts out, and only when HF_TOKEN is
    // set. The input check runs before the cache lookup; the flag is part of
    // the cache key so guarded entries are always ones that passed the
    // output check.
    const guarded = guardrails !== false && guardrailsConfigured();
    const guardState = { status: guarded ? "on" : "off" };
    const guardHeaders = () => ({ "X-Guardrails": guardState.status });
    const history: GuardMessage[] = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      }),
    );

    if (guarded) {
      const verdict = await checkInput(history);
      if (verdict.errors.length) guardState.status = "degraded";
      if (!verdict.allowed) return blockedResponse(verdict, guardHeaders());
    }

    // Keyed on the normalized config (which excludes `stream`), so streamed
    // and non-streamed requests for the same prompt share an entry.
    const cacheKey = makeCacheKey({
      model: selectedModel,
      contents,
      config,
      guarded,
    });
    const cached = skipCache ? undefined : getCachedResponse(cacheKey);
    const lastUser = [...messages]
      .reverse()
      .find((m: { role: string }) => m.role === "user");
    const cacheMeta = {
      model: selectedModel,
      prompt: lastUser?.content ?? "",
      turns: messages.length,
    };

    const textResponse = (text: string, cache: "HIT" | "MISS") => {
      const headers = { ...guardHeaders(), "X-Cache": cache };
      if (params?.stream) {
        return new Response(text, {
          headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      return NextResponse.json({ text }, { headers });
    };

    if (cached !== undefined) return textResponse(cached, "HIT");

    // With guardrails on, the reply has to be checked before any of it
    // reaches the user, so a streaming request is generated in full first
    // and then sent in one piece.
    if (params?.stream && !guarded) {
      const streamResult = await ai.models.generateContentStream({
        model: selectedModel,
        contents,
        config,
      });

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          let receivedAny = false;
          let fullText = "";
          try {
            for await (const chunk of streamResult) {
              if (chunk.text) {
                receivedAny = true;
                fullText += chunk.text;
                controller.enqueue(encoder.encode(chunk.text));
              }
            }
            // Only cache streams that completed; a mid-stream failure
            // leaves a truncated response.
            if (fullText) setCachedResponse(cacheKey, fullText, cacheMeta);
          } catch (error) {
            const message = extractApiErrorMessage(error);
            console.error("Chat stream error:", message);
            if (!receivedAny) {
              controller.enqueue(encoder.encode(`[Error: ${message}]`));
            }
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          ...guardHeaders(),
          "Content-Type": "text/plain; charset=utf-8",
          "X-Cache": "MISS",
        },
      });
    }

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents,
      config,
    });

    const generated = response.candidates?.[0]?.content?.parts?.[0]?.text;

    if (guarded && generated) {
      const verdict = await checkOutput(history, generated);
      if (verdict.errors.length) guardState.status = "degraded";
      if (!verdict.allowed) return blockedResponse(verdict, guardHeaders());
    }

    if (generated) setCachedResponse(cacheKey, generated, cacheMeta);
    return textResponse(generated || "No response generated", "MISS");
  } catch (error) {
    const message = extractApiErrorMessage(error);
    console.error("Chat API error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
