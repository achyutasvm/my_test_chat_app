import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const ragApiUrl = process.env.RAG_API_URL;
    if (!ragApiUrl) {
      return NextResponse.json(
        { error: "RAG_API_URL not configured" },
        { status: 500 },
      );
    }

    const incomingForm = await request.formData();
    const file = incomingForm.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

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

    const data: { filename: string; pages: number; chunks: number } =
      await upstream.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("RAG ingest API error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
