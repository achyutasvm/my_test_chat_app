# My Gemini App

A Next.js chat app with two modes:

- **Chat** — general-purpose chat via Google Gemini (`@google/genai`), with
  adjustable model/temperature/top-p/etc. and streaming responses.
- **Document Q&A** — retrieval-augmented Q&A over PDFs, backed by a companion
  Pinecone + LangChain FastAPI service
  ([vector_embeddings](https://github.com/achyutasvm/vector_embeddings)).
  Answers cite source page numbers, and you can upload new PDFs to the
  knowledge base directly from the UI.

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
RAG_API_URL=http://localhost:8000          # required for Document Q&A mode
```

- Get a Gemini key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
  Chat mode needs billing/credits set up on that project — a valid key alone
  isn't enough if the project's prepay balance is at $0.
- `RAG_API_URL` points at the FastAPI service from the `vector_embeddings`
  repo. Document Q&A mode won't work unless that service is running.

## Running both apps together

```bash
# Terminal 1 — RAG backend (from the vector_embeddings repo)
cd path/to/vector_embeddings
source .venv/bin/activate
uvicorn app.server:app --reload --port 8000

# Terminal 2 — this app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then switch between
**Chat** and **Document Q&A** using the toggle in the header.

## Document Q&A mode

- Ask questions about whatever PDFs have been ingested into the Pinecone
  index. Responses include a `Sources: p. X, p. Y, ...` footer.
- **Upload PDF** (visible only in this mode) sends a file to
  `/api/rag-ingest`, which proxies to the FastAPI service's `POST /ingest` —
  the file is chunked, embedded, and upserted into Pinecone, and becomes
  queryable immediately.
- If uploads or questions fail with a fetch/connection error, the FastAPI
  backend likely isn't running — check `curl http://localhost:8000/health`.

## Project structure

- `app/components/Chat.tsx` — the chat UI, including the mode toggle and
  upload control.
- `app/api/chat/route.ts` — Gemini bridge for Chat mode.
- `app/api/rag-chat/route.ts` — proxies Document Q&A questions to the
  FastAPI `/chat` endpoint.
- `app/api/rag-ingest/route.ts` — proxies PDF uploads to the FastAPI
  `/ingest` endpoint.
- `app/api/feedback/route.ts` — logs thumbs up/down feedback to a local CSV.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [vector_embeddings](https://github.com/achyutasvm/vector_embeddings) — the
  RAG backend this app's Document Q&A mode depends on.
