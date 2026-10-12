// Document Q&A backends. "pinecone" and "qdrant" are vector databases;
// "lightrag" is a LightRAG knowledge-graph service. All three expose the same
// POST /chat and POST /ingest contract.
export type RagBackend = "pinecone" | "qdrant" | "lightrag";

const ENV_VARS: Record<RagBackend, string> = {
  pinecone: "RAG_API_URL_PINECONE",
  qdrant: "RAG_API_URL_QDRANT",
  lightrag: "RAG_API_URL_LIGHTRAG",
};

export function parseRagBackend(value: unknown): RagBackend {
  return value === "qdrant" || value === "lightrag" ? value : "pinecone";
}

// Returns the backend's base URL, or an error message naming the missing
// environment variable.
export function resolveRagApiUrl(
  backend: RagBackend,
): { url: string } | { error: string } {
  const url = process.env[ENV_VARS[backend]];
  return url ? { url } : { error: `${ENV_VARS[backend]} not configured` };
}
