# Gemini Chat App — Quick Start

A Next.js chat app powered by Google Gemini, with a Document Q&A (RAG) mode,
voice input and read-aloud, a response cache, reranking, and guardrails.
This is the short version; [README.md](./README.md) has the details for each
feature.

## Minimum setup (Chat mode)

1. **Get a Gemini API key** at [Google AI Studio](https://aistudio.google.com/apikey).
2. **Create `.env.local`** from the example and add the key:
   ```bash
   cp .env.local.example .env.local
   ```
   ```bash
   GOOGLE_GENAI_API_KEY=your_api_key_here
   ```
3. **Install and run:**
   ```bash
   npm install
   npm run dev
   ```
4. **Open** [http://localhost:3000](http://localhost:3000). If port 3000 is
   taken, run `npm run dev -- -p 3002` and use that port instead.
5. **Pick your settings in the left sidebar:** mode (Chat / Document Q&A),
   model, retrieval and vector store, Rerank, Guardrails, and PDF upload.
   Generation parameters are in the right-hand panel in Chat mode.

That's enough for Chat mode, voice input, read-aloud, and the response cache.

## Optional pieces

| Feature | What you need | Without it |
|---|---|---|
| Document Q&A, Vector DB | One or both vector backends running ([vector_embeddings](https://github.com/achyutasvm/vector_embeddings) on port 8000, [langchain_qdrant_vectordb](https://github.com/achyutasvm/langchain_qdrant_vectordb) on 8001) and `RAG_API_URL_PINECONE` / `RAG_API_URL_QDRANT` set | Vector DB questions return an error |
| Document Q&A, Knowledge graph | [lightrag_service](https://github.com/achyutasvm/lightrag_service) running on port 8002 with a PDF ingested, and `RAG_API_URL_LIGHTRAG` set | Knowledge graph questions return an error |
| Guardrails: Prompt Guard | `GROQ_API_KEY` ([console.groq.com](https://console.groq.com), free tier) | Jailbreak check is skipped |
| Guardrails: Llama Guard | Ollama running with `llama-guard3:8b` (`brew install ollama`, `ollama serve`, `ollama pull llama-guard3:8b`) | Safety check is skipped |

Reranking needs nothing extra in this app; it runs in the RAG backends.

## Live deployment

Deployed on Vercel at
[my-test-chat-app-t153.vercel.app](https://my-test-chat-app-t153.vercel.app);
every push to `master` redeploys it. Environment variables are set in the
Vercel project settings, and the `RAG_API_URL_*` values must be public URLs.
On Vercel, Llama Guard is skipped and feedback isn't saved. See
[Deployment](./README.md#deployment-vercel) for the full list and how the
RAG backends are exposed.

## Features

- Chat with selectable Gemini models, adjustable generation parameters, and streaming
- Document Q&A over uploaded PDFs: vector search (Pinecone or Qdrant, reranked) or a LightRAG knowledge graph (hybrid mode), with cited pages
- Voice input (Gemini transcription) and read-aloud replies (Gemini TTS)
- In-memory response cache, with a development-only viewer at `/dev/cache`
- Guardrails: Prompt Guard (jailbreaks, prompt injection) and Llama Guard (unsafe content)
- Thumbs up/down feedback, message editing, regenerate, and copy
- All settings in a left sidebar, with the active model or backend shown in the header

## Tech stack

- **Frontend:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- **AI models:** Google Gemini via `@google/genai` (chat, transcription, TTS);
  Meta Prompt Guard 2 on Groq and Llama Guard 3 on Ollama (guardrails)
- **RAG backends:** Python FastAPI services in separate projects: LangChain with Pinecone or Qdrant, and LightRAG

## Project structure

- `app/page.tsx` — home page
- `app/components/Chat.tsx` — chat UI and settings sidebar
- `app/components/ModelSettingsPanel.tsx` — generation parameters panel
- `app/api/` — server routes: `chat`, `rag-chat`, `rag-ingest`, `transcribe`, `tts`, `feedback`, `cache`
- `app/utils/` — `guardrails.ts`, `responseCache.ts`
- `.env.local` — environment variables (create from `.env.local.example`)
- `demo/` — team demo deck and demo script

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the pieces connect and
[MODELS.md](./MODELS.md) for which model does what.
