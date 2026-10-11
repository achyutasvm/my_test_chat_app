# My Gemini App

A Next.js chat app with two modes, plus voice input/output, a response
cache, and safety guardrails:

- **Chat** — general-purpose chat via Google Gemini (`@google/genai`), with
  adjustable model/temperature/top-p/etc. and streaming responses.
- **Document Q&A** — retrieval-augmented Q&A over PDFs, backed by a companion
  LangChain FastAPI service. Two interchangeable backends are supported —
  [vector_embeddings](https://github.com/achyutasvm/vector_embeddings) (Pinecone)
  and [langchain_qdrant_vectordb](https://github.com/achyutasvm/langchain_qdrant_vectordb)
  (Qdrant, hybrid dense+sparse retrieval) — chosen per-upload via a selector
  next to the **Upload PDF** button. Retrieved chunks are **reranked** with a
  reranker model before answering. Answers cite source pages in rank order,
  and you can upload new PDFs to the knowledge base directly from the UI.

Both modes support **voice input** (speech-to-text) and **read-aloud replies**
(text-to-speech) using Gemini models, and are protected by **guardrails**:
Meta's Prompt Guard blocks jailbreak / prompt-injection attempts and Llama
Guard blocks unsafe requests and replies. Chat mode responses are **cached in
memory** so repeated requests skip the Gemini call.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the architecture diagram and
request flows, and [MODELS.md](./MODELS.md) for every model and vector store
used and what each one is for.

## Setup

```bash
npm install
cp .env.local.example .env.local
```

Fill in `.env.local`:

```
GOOGLE_GENAI_API_KEY=your_gemini_api_key   # required for Chat mode and voice features
RAG_API_URL_PINECONE=http://localhost:8000 # required to use the Pinecone option
RAG_API_URL_QDRANT=http://localhost:8001   # required to use the Qdrant option
GROQ_API_KEY=your_groq_api_key             # guardrails: Prompt Guard
```

- Get a Gemini key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
  Chat mode needs billing/credits set up on that project — a valid key alone
  isn't enough if the project's prepay balance is at $0.
- You only need to run (and set the URL for) the backend(s) whose option you
  want to use in the vector store selector. If a URL is unset, that option
  will error when selected.
- Guardrails also need [Ollama](https://ollama.com) running locally with the
  Llama Guard model; see [Guardrails](#guardrails). Without it (or without
  `GROQ_API_KEY`), the app still works but skips that guard.

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

# Terminal 3 — Ollama, for the Llama Guard guardrail
ollama serve        # or once: brew services start ollama

# Terminal 4 — this app
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
  index. Responses end with a sources line listing the cited pages in rank
  order (most relevant first), e.g.
  `Sources, reranked: p. 32 (0.537), p. 50 (0.399, ×2), p. 27 (0.310, ×2)`.
  The number is the reranker's relevance score, and `×2` means two chunks came
  from that page. With reranking off it reads
  `Sources, vector search order: p. 27, p. 50, ...`.
- A **Rerank** checkbox (on by default) controls reranking for each question;
  see [Reranking](#reranking).
- **Upload PDF** (visible only in this mode) sends the file and the selected
  `vector_store` to `/api/rag-ingest`, which proxies to that backend's
  `POST /ingest` — the file is chunked, embedded, and upserted, and becomes
  queryable immediately.
- If uploads or questions fail with a fetch/connection error, the
  corresponding FastAPI backend likely isn't running — check
  `curl http://localhost:8000/health` (Pinecone) or
  `curl http://localhost:8001/health` (Qdrant).

## Reranking

Document Q&A only. Vector search returns chunks that *sound* like the
question, which isn't always the chunk that *answers* it. With **Rerank**
checked, the backend retrieves 20 candidate chunks instead of 5–8, scores
each one against the question with a reranker model, and keeps only the best
for the answer.

| Backend | Reranker | Runs |
|---|---|---|
| Pinecone (`vector_embeddings`) | `bge-reranker-v2-m3` | Pinecone-hosted, uses the existing Pinecone key |
| Qdrant (`langchain_qdrant_vectordb`) | `Xenova/ms-marco-MiniLM-L-12-v2` | Locally via `fastembed`, no key |

Reranking happens in the backends: this app only passes `rerank: true/false`
from the checkbox through `/api/rag-chat` to the backend's `POST /chat`. If
the checkbox value isn't sent, the backend's `RERANK_ENABLED` setting
applies. See each backend's README for details and settings.

Questions that show the difference well, on the Apple 10-K:
- "How much did Apple spend on research and development?" Reranking moves
  the income statement with the dollar figures (p. 32) ahead of a table that
  shows R&D only as a percentage (p. 27).
- "How exposed is Apple to changes in foreign exchange rates?" Reranking
  favors the market-risk section over a risk factor that merely mentions
  foreign suppliers.
- "What was Apple's effective tax rate?" A counterexample: reranking puts an
  auditor's note above the passage that states the rate.

Simple lookups ("Where is Apple headquartered?") look the same either way,
because the right chunk is already first.

## Guardrails

Both modes, on by default, with a **Guardrails** toggle in the header.

| Check | Model | Runs | Catches |
|---|---|---|---|
| Input | Prompt Guard 2 (`meta-llama/llama-prompt-guard-2-86m`) | Groq API | Jailbreaks and prompt injection, as a 0–1 score (blocks at ≥ 0.5) |
| Input | Llama Guard 3 (`llama-guard3:8b`) | Locally in Ollama | Unsafe requests in 14 hazard categories (S1 Violent Crimes … S14 Code Interpreter Abuse) |
| Output | Llama Guard 3 | Locally in Ollama | Unsafe replies, judged in the context of the conversation |

**Flow.** `/api/chat` and `/api/rag-chat` run both input checks in parallel
on the latest user message before calling Gemini or the RAG backend. If both
pass, the reply is generated and checked by Llama Guard before anything
reaches the browser. The logic is in `app/utils/guardrails.ts`.

**When something is blocked**, the UI shows an amber notice naming the guard
and the reason, e.g. "Your message was blocked by Llama Guard: Unsafe request
(S2 Non-Violent Crimes)". The blocked message is greyed out, marked "Blocked,
not sent to the model", and left out of the history sent with later
requests. Regenerate on a blocked reply sends its prompt through the guards
again. The API returns `{ "blocked": { stage, guard, reason, ... } }` with an
`X-Guardrails-Blocked: input|output` header.

**Setup.**

1. Set `GROQ_API_KEY` in `.env.local` ([console.groq.com](https://console.groq.com), free tier).
2. Install Ollama and pull Llama Guard (one-time, ~5 GB):
   ```bash
   brew install ollama
   ollama serve                  # or: brew services start ollama
   ollama pull llama-guard3:8b
   ```

The first Llama Guard check after Ollama loads the model takes about 7s;
after that each check takes about 0.5s. The model stays loaded for 30 minutes
after the last check (`LLAMA_GUARD_KEEP_ALIVE`). Prompt Guard checks take
about 0.1s.

**Things to know.**

- **No streaming with guardrails on.** The whole reply has to be checked
  before any of it is shown, so streaming requests arrive in one piece. Turn
  the toggle off to stream again.
- **Fails open by default.** If a guard can't be reached (Ollama not running,
  Groq down, no key), requests go through unchecked by that guard and the
  response carries `X-Guardrails: degraded` (otherwise `on`, or `off` when
  disabled). Set `GUARDRAILS_FAIL_CLOSED=true` to block instead.
- **Cache.** Guarded and unguarded replies are cached separately, and the
  input check runs before the cache lookup, so a cache hit never bypasses
  the guards.
- **Not covered.** Retrieved document chunks aren't scanned, so instructions
  hidden inside an uploaded PDF (indirect prompt injection) aren't caught.
  Guard models also miss some attacks (e.g. other languages, role-play
  framing) and occasionally flag harmless text that uses jailbreak-like
  wording ("ignore the 2023 numbers…").
- **Why these hosts.** Groq hosts Prompt Guard 2 but no longer hosts Llama
  Guard. Hugging Face Inference Providers host both, but need paid credits.

Optional settings (`.env.local`): `GUARDRAILS_ENABLED`,
`GUARDRAILS_FAIL_CLOSED`, `PROMPT_GUARD_MODEL`, `PROMPT_GUARD_THRESHOLD`,
`OLLAMA_URL`, `LLAMA_GUARD_MODEL`, `LLAMA_GUARD_KEEP_ALIVE`. Defaults are in
`.env.local.example`.

## Voice input and read-aloud

Both work in Chat and Document Q&A modes and use the same
`GOOGLE_GENAI_API_KEY`.

**Speech-to-text (voice input)**

- Click the **mic** button next to **Send** to start recording, and click it
  again to stop. The browser asks for microphone permission the first time.
- The recording (captured with the browser's `MediaRecorder`, usually
  `audio/webm`) is posted to `/api/transcribe`, which sends it to
  `gemini-3.6-flash` with a verbatim-transcription prompt.
- The transcript is placed in the input box (appended if you'd already typed
  something) so you can review or edit it before sending. Nothing is sent
  automatically.
- Microphone access only works on `localhost` or over HTTPS. Opening the app
  via a LAN IP over plain HTTP will fail with "Microphone access was denied".

**Text-to-speech (read-aloud)**

- Every assistant reply has a **speaker** button. Click it to hear the reply.
  It shows a spinner while the audio is being generated, then a **stop**
  button while playing. Starting another reply stops the current one.
- The reply text (up to 5,000 characters) is posted to `/api/tts`, which calls
  `gemini-3.8-flash-tts` with the prebuilt `Kore` voice and returns WAV audio.
  If a model returns raw PCM instead (older Gemini TTS models do), the route
  wraps it in a WAV header so browsers can play it.
- To change the voice or model, edit `DEFAULT_VOICE` / `TTS_MODEL` in
  `app/api/tts/route.ts`. The transcription model is `TRANSCRIBE_MODEL` in
  `app/api/transcribe/route.ts`.

## Response cache

Chat mode responses are cached in memory on the Next.js server, so sending a
request that has already been answered returns instantly instead of calling
Gemini again.

- **What counts as the same request:** the cache key is a SHA-256 hash of the
  model, the **entire conversation so far**, and the normalized generation
  settings (temperature, top-p, max tokens, etc.). Changing any of them is a
  miss.
- **Repeats within a chat don't hit.** Asking the same question again later
  in the same conversation is a different request, because the earlier
  messages differ. Repeats hit when they're asked as the first message of a
  new chat, or when the same conversation is replayed. This is deliberate:
  Gemini's answer depends on the earlier messages, so matching on the
  question text alone could serve the wrong answer to follow-ups like
  "show me an example".
- **Streaming:** streamed and non-streamed requests share entries. A streamed
  response is only cached after it completes without errors, and errors are
  never cached.
- **Regenerate** always bypasses the cache (`skipCache: true`) and replaces
  the stored answer with the new one.
- **Limits:** up to 500 entries, each kept for 1 hour, with the least recently
  used evicted first. Change `MAX_ENTRIES` / `TTL_MS` in
  `app/utils/responseCache.ts`.
- **Persistence:** the cache lives in the server process. It's cleared on
  restart and isn't shared between server instances.
- **Not cached:** Document Q&A answers (uploading a PDF would make them stale)
  and read-aloud audio.

**Seeing it work**

- Replies served from the cache show a grey **Cached** label.
- `/api/chat` responses carry an `X-Cache: HIT` or `X-Cache: MISS` header.
- In development, the sidebar has a **Response cache** link to
  [`/dev/cache`](http://localhost:3000/dev/cache). The page lists every entry
  with its prompt, model, message count, hit count, age, and time to expiry.
  You can expand the cached response, filter entries, delete single entries,
  or clear the cache. It's backed by `GET /api/cache` and
  `DELETE /api/cache` (or `DELETE /api/cache?key=<hash>` for one entry).
- The viewer page and `/api/cache` return **404 in production builds**, since
  they expose stored prompts and responses.

## Project structure

- `app/components/Chat.tsx` — the chat UI, including the mode toggle, vector
  store selector, Rerank and Guardrails toggles, upload control, mic and
  read-aloud buttons, Cached label, ranked sources line, and blocked-message
  notices.
- `app/api/chat/route.ts` — Gemini bridge for Chat mode, with guardrails and
  response caching.
- `app/api/rag-chat/route.ts` — proxies Document Q&A questions (and the
  rerank flag) to the selected backend's `/chat` endpoint, with guardrails.
- `app/api/rag-ingest/route.ts` — proxies PDF uploads to the selected
  backend's `/ingest` endpoint.
- `app/api/feedback/route.ts` — logs thumbs up/down feedback to a local CSV.
- `app/api/transcribe/route.ts` — speech-to-text: transcribes recorded audio
  with Gemini.
- `app/api/tts/route.ts` — text-to-speech: turns a reply into WAV audio with a
  Gemini TTS model.
- `app/utils/guardrails.ts` — Prompt Guard and Llama Guard input/output checks.
- `app/utils/responseCache.ts` — the in-memory LRU response cache.
- `app/api/cache/route.ts` — development-only API to list and clear cache
  entries.
- `app/dev/cache/` — development-only cache viewer page.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [vector_embeddings](https://github.com/achyutasvm/vector_embeddings) — the
  Pinecone RAG backend.
- [langchain_qdrant_vectordb](https://github.com/achyutasvm/langchain_qdrant_vectordb) —
  the Qdrant RAG backend.
