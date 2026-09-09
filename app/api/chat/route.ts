import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

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
    const { messages, model, params } = await request.json();
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

    if (params?.stream) {
      const streamResult = await ai.models.generateContentStream({
        model: selectedModel,
        contents,
        config,
      });

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          let receivedAny = false;
          try {
            for await (const chunk of streamResult) {
              if (chunk.text) {
                receivedAny = true;
                controller.enqueue(encoder.encode(chunk.text));
              }
            }
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
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents,
      config,
    });

    const text =
      response.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response generated";

    return NextResponse.json({ text });
  } catch (error) {
    const message = extractApiErrorMessage(error);
    console.error("Chat API error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
