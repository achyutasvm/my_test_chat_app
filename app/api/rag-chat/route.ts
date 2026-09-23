import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface Source {
  source: string;
  page: number | null;
}

type VectorStore = "pinecone" | "qdrant";

function resolveRagApiUrl(vectorStore: VectorStore): string | undefined {
  return vectorStore === "qdrant"
    ? process.env.RAG_API_URL_QDRANT
    : process.env.RAG_API_URL_PINECONE;
}

export async function POST(request: NextRequest) {
  try {
    const { messages, vectorStore: rawVectorStore } = await request.json();
    const vectorStore: VectorStore =
      rawVectorStore === "qdrant" ? "qdrant" : "pinecone";

    const ragApiUrl = resolveRagApiUrl(vectorStore);
    if (!ragApiUrl) {
      return NextResponse.json(
        {
          error:
            vectorStore === "qdrant"
              ? "RAG_API_URL_QDRANT not configured"
              : "RAG_API_URL_PINECONE not configured",
        },
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
