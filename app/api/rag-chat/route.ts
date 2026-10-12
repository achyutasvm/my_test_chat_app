import { NextRequest, NextResponse } from "next/server";
import {
  blockedResponse,
  checkInput,
  checkOutput,
  GuardMessage,
  guardrailsConfigured,
} from "../../utils/guardrails";

export const runtime = "nodejs";

interface Source {
  source: string;
  page: number | null;
  rerank_score?: number | null;
}

import { parseRagBackend, resolveRagApiUrl } from "../../utils/ragBackends";

export async function POST(request: NextRequest) {
  try {
    const {
      messages,
      vectorStore: rawVectorStore,
      rerank,
      guardrails,
    } = await request.json();
    const backend = parseRagBackend(rawVectorStore);
    const resolved = resolveRagApiUrl(backend);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 500 });
    }
    const ragApiUrl = resolved.url;

    const guarded = guardrails !== false && guardrailsConfigured();
    let guardStatus = guarded ? "on" : "off";
    const history: GuardMessage[] = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      }),
    );

    if (guarded) {
      const verdict = await checkInput(history);
      if (verdict.errors.length) guardStatus = "degraded";
      if (!verdict.allowed) {
        return blockedResponse(verdict, { "X-Guardrails": guardStatus });
      }
    }

    const upstream = await fetch(`${ragApiUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Omit `rerank` unless it's a boolean so the backend's RERANK_ENABLED
      // default applies.
      body: JSON.stringify({
        messages,
        ...(typeof rerank === "boolean" ? { rerank } : {}),
      }),
    });

    if (!upstream.ok) {
      let message = "Failed to fetch response from RAG service";
      try {
        const errorData = await upstream.json();
        if (errorData?.detail) message = errorData.detail;
      } catch {
        // response body wasn't JSON; keep the default message
      }
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const data: { text: string; sources: Source[] } = await upstream.json();

    if (guarded) {
      const verdict = await checkOutput(history, data.text);
      if (verdict.errors.length) guardStatus = "degraded";
      if (!verdict.allowed) {
        return blockedResponse(verdict, { "X-Guardrails": guardStatus });
      }
    }

    return NextResponse.json(
      { text: data.text, sources: data.sources },
      { headers: { "X-Guardrails": guardStatus } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("RAG chat API error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
