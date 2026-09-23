# My Gemini App

A Next.js chat app with two modes:

- **Chat** — general-purpose chat via Google Gemini (`@google/genai`), with
  adjustable model/temperature/top-p/etc. and streaming responses.
- **Document Q&A** — retrieval-augmented Q&A over PDFs, backed by a companion
  LangChain FastAPI service. Two interchangeable backends are supported —
  [vector_embeddings](https://github.com/achyutasvm/vector_embeddings) (Pinecone)
  and [langchain_qdrant_vectordb](https://github.com/achyutasvm/langchain_qdrant_vectordb)
  (Qdrant, hybrid dense+sparse retrieval) — chosen per-upload via a selector
  next to the **Upload PDF** button. Answers cite source page numbers, and you
  can upload new PDFs to the knowledge base directly from the UI.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the original Gemini-only request
flow diagram. It predates the Document Q&A mode below.

## Setup

```bash
npm install
cp .env.local.example .env.local
```

Fill in `.env.local`:

```
GOOGLE_GENAI_API_KEY=your_gemini_api_key   # required for Chat mode
RAG_API_URL_PINECONE=http://localhost:8000 # required to use the Pinecone option
RAG_API_URL_QDRANT=http://localhost:8001   # required to use the Qdrant option
```

- Get a Gemini key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
  Chat mode needs billing/credits set up on that project — a valid key alone
  isn't enough if the project's prepay balance is at $0.
- You only need to run (and set the URL for) the backend(s) whose option you
  want to use in the vector store selector. If a URL is unset, that option
  will error when selected.

## Running everything together

```bash
# Terminal 1 — Qdrant RAG backend (langchain_qdrant_vectordb repo)
cd path/to/langchain_qdrant_vectordb
source .venv/bin/activate
uvicorn app.server:app --reload --port 8001

# Terminal 2 — Pinecone RAG backend (vector_embeddings repo), optional
cd path/to/vector_embeddings
source .venv/bin/activate
uvicorn app.server:app --reload --port 8000

# Terminal 3 — this app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then switch between
**Chat** and **Document Q&A** using the toggle in the header.

## Document Q&A mode

- A **Pinecone / Qdrant** selector next to the upload control picks which
  backend a PDF is ingested into. Questions are sent to whichever backend was
  last selected, so switch the selector to match wherever your PDFs actually
  live before asking.
- Ask questions about whatever PDFs have been ingested into the selected
  index. Responses include a `Sources: p. X, p. Y, ...` footer.
- **Upload PDF** (visible only in this mode) sends the file and the selected
  `vector_store` to `/api/rag-ingest`, which proxies to that backend's
  `POST /ingest` — the file is chunked, embedded, and upserted, and becomes
  queryable immediately.
- If uploads or questions fail with a fetch/connection error, the
  corresponding FastAPI backend likely isn't running — check
  `curl http://localhost:8000/health` (Pinecone) or
  `curl http://localhost:8001/health` (Qdrant).

## Project structure

- `app/components/Chat.tsx` — the chat UI, including the mode toggle, vector
  store selector, and upload control.
- `app/api/chat/route.ts` — Gemini bridge for Chat mode.
- `app/api/rag-chat/route.ts` — proxies Document Q&A questions to the
  selected backend's `/chat` endpoint.
- `app/api/rag-ingest/route.ts` — proxies PDF uploads to the selected
  backend's `/ingest` endpoint.
- `app/api/feedback/route.ts` — logs thumbs up/down feedback to a local CSV.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [vector_embeddings](https://github.com/achyutasvm/vector_embeddings) — the
  Pinecone RAG backend.
- [langchain_qdrant_vectordb](https://github.com/achyutasvm/langchain_qdrant_vectordb) —
  the Qdrant RAG backend.
