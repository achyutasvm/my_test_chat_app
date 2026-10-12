import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

import { parseRagBackend, resolveRagApiUrl } from "../../utils/ragBackends";

export async function POST(request: NextRequest) {
  try {
    const incomingForm = await request.formData();
    const file = incomingForm.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const vectorStore = parseRagBackend(incomingForm.get("vector_store"));
    const resolved = resolveRagApiUrl(vectorStore);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 500 });
    }
    const ragApiUrl = resolved.url;

    const upstreamForm = new FormData();
    upstreamForm.append("file", file, file.name);

    const upstream = await fetch(`${ragApiUrl}/ingest`, {
      method: "POST",
      body: upstreamForm,
    });

    if (!upstream.ok) {
      let message = "Failed to ingest document";
      try {
        const errorData = await upstream.json();
        if (errorData?.detail) message = errorData.detail;
      } catch {
        // response body wasn't JSON; keep the default message
      }
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Vector stores return { filename, pages, chunks } once ingestion is done.
    // LightRAG returns { filename, pages, track_id, status: "processing" }
    // straight away and builds the knowledge graph in the background; poll
    // GET /api/rag-ingest?vector_store=lightrag&track_id=... for progress.
    const data = await upstream.json();
    return NextResponse.json({ ...data, vectorStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("RAG ingest API error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// Progress of a background (LightRAG) ingest: proxies GET /ingest/{track_id}.
export async function GET(request: NextRequest) {
  const trackId = request.nextUrl.searchParams.get("track_id");
  if (!trackId || !/^[\w-]{1,64}$/.test(trackId)) {
    return NextResponse.json({ error: "Invalid track_id" }, { status: 400 });
  }
  const backend = parseRagBackend(
    request.nextUrl.searchParams.get("vector_store"),
  );
  const resolved = resolveRagApiUrl(backend);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 500 });
  }
  try {
    const upstream = await fetch(
      `${resolved.url}/ingest/${encodeURIComponent(trackId)}`,
    );
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
