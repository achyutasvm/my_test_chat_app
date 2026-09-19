import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface Source {
  source: string;
  page: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    const ragApiUrl = process.env.RAG_API_URL;
    if (!ragApiUrl) {
      return NextResponse.json(
        { error: "RAG_API_URL not configured" },
        { status: 500 },
      );
    }

    const upstream = await fetch(`${ragApiUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
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

    return NextResponse.json({ text: data.text, sources: data.sources });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("RAG chat API error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
