# Models and Services

Every model and vector store used by this app and its two RAG backends
([vector_embeddings](https://github.com/achyutasvm/vector_embeddings), Pinecone;
[langchain_qdrant_vectordb](https://github.com/achyutasvm/langchain_qdrant_vectordb),
Qdrant), grouped by purpose. All models are used as-is; nothing in these
repos fine-tunes or trains a model.

Model names here are the defaults in code, and match the current `.env`
settings. Where a setting can override one, it's listed under "Configured in".

## Summary

| Category | In use | Where |
|---|---|---|
| **Inference (answers)** | Gemini 3 Flash Preview (default), Gemini 3.6 Flash and Gemini 3 Pro Image Preview for chat; OpenAI gpt-4o-mini for Document Q&A answers | Chat mode; both RAG backends |
| **Embedding** | Pinecone `llama-text-embed-v2` (1024 dims); OpenAI `text-embedding-3-small` plus `Qdrant/bm25` keyword vectors | Pinecone backend; Qdrant backend (hybrid search) |
| **Vector stores** | Pinecone serverless (index `rag-docs`); Qdrant Cloud (collection `10k_filing`) | One per backend |
| **Ranking (rerankers)** | Pinecone `bge-reranker-v2-m3`; `Xenova/ms-marco-MiniLM-L-12-v2`, run locally | One per backend |
| **Guardrails** | Prompt Guard 2 86M on Groq; Llama Guard 3 8B in local Ollama | This app, both modes |
| **Speech-to-text / text-to-speech** | Gemini 3.6 Flash (STT); Gemini 3.8 Flash TTS with the "Kore" voice | This app, both modes |
| **Evaluators** | gpt-oss-120b on Groq and Gemini 3.6 Flash as judges, grading answers that gpt-4o-mini produced | Pinecone backend's `eval/` scripts |
| **Fine-tuning** | None | — |
| **Training** | None | — |

The sections below give each model's provider, whether it runs hosted or
locally, what it's used for, and the file or setting that controls it.

## Inference models

Models that generate the answers users see.

| Model | Provider | Used for | Configured in |
|---|---|---|---|
| `gemini-3-flash-preview` | Google Gemini API | Chat mode, default model | `app/api/chat/route.ts` (`AVAILABLE_MODELS`), model dropdown in `Chat.tsx` |
| `gemini-3.6-flash` | Google Gemini API | Chat mode, selectable | same |
| `gemini-3-pro-image-preview` | Google Gemini API | Chat mode, selectable. An image-generation model, but the app only sends and shows text | same |
| `gpt-4o-mini` | OpenAI API | Document Q&A answers, in both RAG backends, at temperature 0 from the retrieved chunks | `OPENAI_MODEL` in each backend's `.env` |

Chat mode's generation settings (temperature, top-p, top-k, max tokens,
penalties, stop sequences, seed, reasoning level, JSON mode, streaming) come
from the parameters panel. Document Q&A answers don't use them.

## Embedding models

Turn text into vectors for search. Used when a PDF is ingested and when a
question is asked.

| Model | Provider | Type | Used in | Configured in |
|---|---|---|---|---|
| `llama-text-embed-v2` (1024 dims) | Pinecone (hosted inference) | Dense | Pinecone backend | `PINECONE_EMBEDDING_MODEL`, `PINECONE_EMBEDDING_DIMENSION` |
| `text-embedding-3-small` | OpenAI API | Dense | Qdrant backend | `OPENAI_EMBEDDING_MODEL` |
| `Qdrant/bm25` | fastembed, runs locally | Sparse (keyword) | Qdrant backend, combined with the dense vectors for hybrid search | `SPARSE_MODEL` |

This app doesn't call any embedding model itself.

## Vector stores

Not models, but where the embeddings live. The Document Q&A header has a
Pinecone / Qdrant selector to pick one.

| Store | Hosting | Index / collection | Search | Used by |
|---|---|---|---|---|
| Pinecone | Pinecone serverless (cloud) | index `rag-docs`, namespace `docs` | Dense similarity | `vector_embeddings` (port 8000) |
| Qdrant | Qdrant Cloud | collection `10k_filing` | Hybrid: dense + BM25 sparse | `langchain_qdrant_vectordb` (port 8001) |

Both split PDFs into 1000-character chunks with 150 characters of overlap,
within page boundaries.

## Ranking models (rerankers)

Reorder retrieved chunks by relevance before answer generation. Each backend
retrieves 20 candidates, reranks them, and keeps the top 5 (Pinecone) or 8
(Qdrant). The **Rerank** checkbox in Document Q&A turns this on or off for
each question. See [Reranking](./README.md#reranking).

| Model | Provider | Scores | Used in | Configured in |
|---|---|---|---|---|
| `bge-reranker-v2-m3` | Pinecone (hosted inference) | 0 to 1 | Pinecone backend | `RERANK_MODEL`, `RERANK_ENABLED`, `RERANK_CANDIDATES` |
| `Xenova/ms-marco-MiniLM-L-12-v2` | fastembed cross-encoder, runs locally (~130 MB, downloaded on first use) | Raw logits, can be negative | Qdrant backend | same settings |

## Guardrails

Safety classifiers that run in this app, in both modes, when the
**Guardrails** toggle is on. See [Guardrails](./README.md#guardrails).

| Model | Provider | Checks | Output | Configured in |
|---|---|---|---|---|
| `meta-llama/llama-prompt-guard-2-86m` (Prompt Guard 2) | Groq API | Latest user message, for jailbreaks and prompt injection | Probability 0–1; blocks at ≥ 0.5 | `PROMPT_GUARD_MODEL`, `PROMPT_GUARD_THRESHOLD`, `GROQ_API_KEY` |
| `llama-guard3:8b` (Llama Guard 3) | Ollama, runs locally | User messages before the model, and replies after it | `safe`, or `unsafe` with hazard categories S1–S14 | `LLAMA_GUARD_MODEL`, `OLLAMA_URL`, `LLAMA_GUARD_KEEP_ALIVE` |

Hugging Face Inference Providers also host both (with Llama Guard 4 12B), but
need paid credits, so they aren't used.

## Speech-to-text and text-to-speech

Voice input and read-aloud, in this app, in both modes. See
[Voice input and read-aloud](./README.md#voice-input-and-read-aloud).

| Model | Provider | Used for | Configured in |
|---|---|---|---|
| `gemini-3.6-flash` | Google Gemini API | Speech-to-text: transcribes the recorded audio, verbatim, at temperature 0 | `TRANSCRIBE_MODEL` in `app/api/transcribe/route.ts` |
| `gemini-3.8-flash-tts` | Google Gemini API | Text-to-speech: reads a reply aloud, prebuilt voice **Kore**, returned as WAV | `TTS_MODEL`, `DEFAULT_VOICE` in `app/api/tts/route.ts` |

## Evaluators

LLM-as-a-judge checks of Document Q&A answer quality. They run offline, as
scripts, not inside the app.

| Model | Provider | Role | Where |
|---|---|---|---|
| `gpt-4o-mini` | OpenAI API | Generates the answers being judged, through the real `app/rag.py` pipeline | `vector_embeddings/eval/generate_answers.py` |
| `openai/gpt-oss-120b` | Groq API | Judge 1: marks each answer correct or incorrect | `JUDGES` in `vector_embeddings/eval/evaluate_answers.py` |
| `gemini-3.6-flash` | Google Gemini API | Judge 2, independent of judge 1 | same |

The Qdrant repo has an `eval/` folder too, but it's uncommitted work in
progress. It still uses Pinecone for retrieval and two judge models that the
providers have since retired (`llama-3.3-70b-versatile`, `gemini-2.5-flash`),
so it doesn't evaluate the Qdrant pipeline yet.

## Fine-tuning and training

Not used. Every model above is a pretrained model called as-is, through a
hosted API or a local runtime (Ollama, fastembed). The system is adapted to
the documents through retrieval (RAG), not by changing model weights, and
none of the repos contain fine-tuning, training, or labelled-dataset code.

If that changes, the most likely candidates are:
- **Fine-tuning the reranker** or the embedding model on question–passage
  pairs from your own documents. The eval harness's question set would be a
  starting point.
- **Fine-tuning the generation model** for answer format or tone, for example
  through OpenAI's or Google's fine-tuning APIs.

## Accounts and keys

| Key | Used for |
|---|---|
| `GOOGLE_GENAI_API_KEY` (this app) | Gemini chat, STT, TTS |
| `GROQ_API_KEY` (this app; also the Pinecone backend's eval) | Prompt Guard; eval judge |
| `PINECONE_API_KEY` (Pinecone backend) | Pinecone index, embeddings, reranker |
| `OPENAI_API_KEY` (both backends) | Answer generation; Qdrant backend embeddings |
| `QDRANT_URL`, `QDRANT_API_KEY` (Qdrant backend) | Qdrant Cloud |
| `GOOGLE_API_KEY` (Pinecone backend's eval) | Gemini judge |

Llama Guard (Ollama), BM25, and the Qdrant reranker (fastembed) run locally
and need no key.
