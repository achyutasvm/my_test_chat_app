"use client";

import { useState, useRef, useEffect } from "react";
import {
  Menu,
  Plus,
  MessageCircle,
  Settings,
  HelpCircle,
  Copy,
  Check,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  RotateCw,
  PanelRightOpen,
  CloudUpload,
  Mic,
  Square,
  Volume2,
  Loader2,
  Database,
  ShieldCheck,
  ShieldAlert,
  PanelLeftClose,
  Sparkles,
  MessageSquare,
  FileText,
  ArrowUp,
} from "lucide-react";
import Link from "next/link";
import ModelSettingsPanel, {
  DEFAULT_MODEL_PARAMS,
  ModelParams,
} from "./ModelSettingsPanel";

interface Message {
  role: "user" | "assistant";
  content: string;
  feedback?: "up" | "down" | null;
  cached?: boolean;
  // Set on an assistant message that replaced a reply blocked by guardrails.
  blocked?: GuardBlock;
  // Set on a user message whose exchange was blocked; it's kept on screen
  // but never sent to the model again.
  excluded?: boolean;
}

interface GuardBlock {
  stage: "input" | "output";
  guard: "prompt-guard" | "llama-guard" | "unavailable";
  reason: string;
  categories?: string[];
  score?: number;
}

const GUARD_NAMES: Record<GuardBlock["guard"], string> = {
  "prompt-guard": "Prompt Guard",
  "llama-guard": "Llama Guard",
  unavailable: "Guardrails",
};

function describeBlock(block: GuardBlock): string {
  const what =
    block.stage === "input"
      ? "Your message was blocked"
      : "The response was blocked";
  const score =
    block.score !== undefined ? ` (score ${block.score.toFixed(3)})` : "";
  return `${what} by ${GUARD_NAMES[block.guard]}: ${block.reason}${score}.`;
}

// Drops blocked exchanges (and client-only fields) before sending history to
// the server, so the model never sees a blocked prompt or reply.
function toApiMessages(messages: Message[]) {
  return messages
    .filter((m) => !m.excluded && !m.blocked)
    .map(({ role, content }) => ({ role, content }));
}

interface RagSource {
  source: string;
  page: number | null;
  rerank_score?: number | null;
}

// Sources arrive in rank order (reranker order when reranking ran, vector
// search order otherwise, or LightRAG's context order for the knowledge graph). Keep that order, merge chunks from the same page
// into one entry (keeping its best-ranked score), and show the score when
// there is one, e.g. "p. 32 (0.537), p. 50 ×2, p. 27".
function formatSources(sources: RagSource[], graph = false): string | null {
  const pages: { page: number; score: number | null; count: number }[] = [];
  for (const s of sources) {
    if (s.page == null) continue;
    const existing = pages.find((p) => p.page === s.page);
    if (existing) existing.count += 1;
    else pages.push({ page: s.page, score: s.rerank_score ?? null, count: 1 });
  }
  if (pages.length === 0) return null;

  const reranked = pages.some((p) => p.score !== null);
  const labels = pages.map(({ page, score, count }) => {
    const details = [
      score !== null ? score.toFixed(Math.abs(score) >= 1 ? 2 : 3) : null,
      count > 1 ? `×${count}` : null,
    ].filter(Boolean);
    return details.length ? `p. ${page} (${details.join(", ")})` : `p. ${page}`;
  });
  const label = graph
    ? "Sources, knowledge graph (hybrid)"
    : reranked
      ? "Sources, reranked"
      : "Sources, vector search order";
  return `${label}: ${labels.join(", ")}`;
}

type ChatMode = "chat" | "rag";
type VectorStore = "pinecone" | "qdrant";
// Document Q&A retrieval: a vector database (Pinecone/Qdrant) or the LightRAG
// knowledge graph.
type Retrieval = "vector" | "graph";

const VECTOR_STORES: { id: VectorStore; label: string }[] = [
  { id: "pinecone", label: "Pinecone" },
  { id: "qdrant", label: "Qdrant" },
];

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}

const AVAILABLE_MODELS = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image (Preview)" },
];

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mode, setMode] = useState<ChatMode>("chat");
  const [vectorStore, setVectorStore] = useState<VectorStore>("pinecone");
  const [rerank, setRerank] = useState(true);
  const [retrieval, setRetrieval] = useState<Retrieval>("vector");
  // Backend that Document Q&A questions and uploads go to.
  const ragBackend = retrieval === "graph" ? "lightrag" : vectorStore;
  const ingestPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [guardrails, setGuardrails] = useState(true);
  const [model, setModel] = useState(AVAILABLE_MODELS[0].id);
  const [modelParams, setModelParams] =
    useState<ModelParams>(DEFAULT_MODEL_PARAMS);
  const [paramsOpen, setParamsOpen] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    kind: "success" | "error" | "progress";
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [ttsLoadingIndex, setTtsLoadingIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentConv = conversations.find((c) => c.id === currentConvId);
  const messages = currentConv?.messages || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startNewChat = () => {
    const newId = Date.now().toString();
    setConversations((prev) => [
      ...prev,
      { id: newId, title: "New chat", messages: [] },
    ]);
    setCurrentConvId(newId);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setUploadStatus(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("vector_store", ragBackend);

      const response = await fetch("/api/rag-ingest", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Upload failed");
      }

      if (data.status === "processing" && data.track_id) {
        // LightRAG builds the knowledge graph in the background.
        setUploadStatus({
          kind: "progress",
          message: `Building knowledge graph from "${data.filename}" (${data.pages} pages)...`,
        });
        pollIngest(data.track_id, data.filename, data.pages);
        return;
      }

      const storeLabel =
        VECTOR_STORES.find((s) => s.id === vectorStore)?.label ?? vectorStore;
      setUploadStatus({
        kind: "success",
        message: `Ingested "${data.filename}" into ${storeLabel}: ${data.pages} pages, ${data.chunks} chunks.`,
      });
    } catch (error) {
      setUploadStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Upload failed",
      });
    } finally {
      setUploading(false);
    }
  };

  // Polls a background LightRAG ingest until every page is processed or failed.
  const pollIngest = (trackId: string, filename: string, pages: number) => {
    if (ingestPollRef.current) clearInterval(ingestPollRef.current);
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/rag-ingest?vector_store=lightrag&track_id=${encodeURIComponent(trackId)}`,
        );
        const data: { counts?: Record<string, number>; done?: boolean } =
          await response.json();
        if (!response.ok || !data.counts) return;
        const processed = data.counts.processed ?? 0;
        const failed = data.counts.failed ?? 0;
        const duplicate = data.counts.duplicate ?? 0;
        if (data.done) {
          if (ingestPollRef.current) clearInterval(ingestPollRef.current);
          ingestPollRef.current = null;
          const details = [
            `${processed} of ${pages} pages added`,
            duplicate ? `${duplicate} already in the graph` : null,
            failed ? `${failed} failed` : null,
          ]
            .filter(Boolean)
            .join(", ");
          setUploadStatus({
            kind: failed ? "error" : "success",
            message: `Knowledge graph updated from "${filename}": ${details}.`,
          });
        } else {
          setUploadStatus({
            kind: "progress",
            message: `Building knowledge graph from "${filename}": ${processed + failed + duplicate} of ${pages} pages done...`,
          });
        }
      } catch {
        // transient network error; try again on the next tick
      }
    };
    ingestPollRef.current = setInterval(poll, 5000);
    poll();
  };

  useEffect(() => {
    return () => {
      if (ingestPollRef.current) clearInterval(ingestPollRef.current);
    };
  }, []);

  // Marks the user message as excluded from future requests and adds an
  // assistant message explaining what was blocked.
  const addBlockedReply = (
    convId: string,
    userIndex: number,
    blocked: GuardBlock,
  ) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: [
                ...c.messages.map((m, i) =>
                  i === userIndex ? { ...m, excluded: true } : m,
                ),
                {
                  role: "assistant",
                  content: describeBlock(blocked),
                  blocked,
                },
              ],
            }
          : c,
      ),
    );
  };

  const getRagCompletion = async (convId: string, apiMessages: Message[]) => {
    const response = await fetch("/api/rag-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: toApiMessages(apiMessages),
        vectorStore: ragBackend,
        rerank,
        guardrails,
      }),
    });

    if (!response.ok) {
      let message = "Failed to fetch response";
      try {
        const errorData = await response.json();
        if (errorData?.error) message = errorData.error;
      } catch {
        // response body wasn't JSON; keep the default message
      }
      throw new Error(message);
    }

    if (response.headers.get("X-Guardrails-Blocked")) {
      const { blocked } = await response.json();
      addBlockedReply(convId, apiMessages.length - 1, blocked);
      return;
    }

    const data: { text: string; sources: RagSource[] } = await response.json();

    const sourcesLine = formatSources(
      data.sources ?? [],
      ragBackend === "lightrag",
    );
    const content = sourcesLine ? `${data.text}\n\n${sourcesLine}` : data.text;

    const assistantMessage: Message = {
      role: "assistant",
      content,
      feedback: null,
    };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, messages: [...c.messages, assistantMessage] }
          : c,
      ),
    );
  };

  const getCompletion = async (
    convId: string,
    apiMessages: Message[],
    skipCache = false,
  ) => {
    setLoading(true);

    if (mode === "rag") {
      try {
        await getRagCompletion(convId, apiMessages);

        if (apiMessages.length === 1) {
          const title =
            apiMessages[0].content.substring(0, 30) +
            (apiMessages[0].content.length > 30 ? "..." : "");
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, title } : c)),
          );
        }
      } catch (error) {
        console.error("Error:", error);
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Sorry, I encountered an error. Please try again.";
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: [
                    ...c.messages,
                    { role: "assistant", content: message },
                  ],
                }
              : c,
          ),
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    const stopSequences = modelParams.stopSequences
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const requestParams = {
      temperature: modelParams.temperature,
      maxOutputTokens: modelParams.maxOutputTokens,
      topP: modelParams.topP,
      topK: modelParams.topK,
      frequencyPenalty: modelParams.frequencyPenalty,
      presencePenalty: modelParams.presencePenalty,
      stopSequences,
      seed: modelParams.seed,
      reasoningLevel: modelParams.reasoningLevel,
      stream: modelParams.stream,
      jsonMode: modelParams.jsonMode,
    };

    let placeholderAdded = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: toApiMessages(apiMessages),
          model,
          params: requestParams,
          skipCache,
          guardrails,
        }),
      });

      if (!response.ok) {
        let message = "Failed to fetch response";
        try {
          const errorData = await response.json();
          if (errorData?.error) message = errorData.error;
        } catch {
          // response body wasn't JSON; keep the default message
        }
        throw new Error(message);
      }

      if (response.headers.get("X-Guardrails-Blocked")) {
        const { blocked } = await response.json();
        addBlockedReply(convId, apiMessages.length - 1, blocked);
        return;
      }

      const cached = response.headers.get("X-Cache") === "HIT";

      if (requestParams.stream && response.body) {
        const assistantIndex = apiMessages.length;
        placeholderAdded = true;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: [
                    ...c.messages,
                    {
                      role: "assistant",
                      content: "",
                      feedback: null,
                      cached,
                    },
                  ],
                }
              : c,
          ),
        );

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          const content = accumulated;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m, i) =>
                      i === assistantIndex ? { ...m, content } : m,
                    ),
                  }
                : c,
            ),
          );
        }
      } else {
        const data = await response.json();
        const assistantMessage: Message = {
          role: "assistant",
          content: data.text,
          feedback: null,
          cached,
        };

        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? { ...c, messages: [...c.messages, assistantMessage] }
              : c,
          ),
        );
      }

      if (apiMessages.length === 1) {
        const title =
          apiMessages[0].content.substring(0, 30) +
          (apiMessages[0].content.length > 30 ? "..." : "");
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, title } : c)),
        );
      }
    } catch (error) {
      console.error("Error:", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Sorry, I encountered an error. Please try again.";

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          if (placeholderAdded) {
            return {
              ...c,
              messages: c.messages.map((m, i) =>
                i === c.messages.length - 1 ? { ...m, content: message } : m,
              ),
            };
          }
          return {
            ...c,
            messages: [...c.messages, { role: "assistant", content: message }],
          };
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    if (!currentConvId) {
      startNewChat();
    }

    const convId = currentConvId || Date.now().toString();
    const userMessage: Message = { role: "user", content: input };
    const apiMessages = [...messages, userMessage];

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, userMessage] } : c,
      ),
    );

    setInput("");
    await getCompletion(convId, apiMessages);
  };

  const transcribeAudio = async (blob: Blob) => {
    setTranscribing(true);
    try {
      const formData = new FormData();
      formData.append("audio", blob, "recording");
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Transcription failed");
      if (!data.text) {
        setVoiceError("No speech detected. Try again.");
        return;
      }
      setInput((prev) =>
        prev.trim() ? `${prev.trim()} ${data.text}` : data.text,
      );
    } catch (error) {
      setVoiceError(
        error instanceof Error ? error.message : "Transcription failed",
      );
    } finally {
      setTranscribing(false);
    }
  };

  const startRecording = async () => {
    setVoiceError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Voice input isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size > 0) transcribeAudio(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setVoiceError("Microphone access was denied.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const stopSpeaking = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      URL.revokeObjectURL(audio.src);
      audioRef.current = null;
    }
    setSpeakingIndex(null);
  };

  const handleSpeak = async (idx: number, content: string) => {
    if (speakingIndex === idx) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    setTtsLoadingIndex(idx);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      if (!response.ok) {
        let message = "Failed to generate speech";
        try {
          const errorData = await response.json();
          if (errorData?.error) message = errorData.error;
        } catch {
          // response body wasn't JSON; keep the default message
        }
        throw new Error(message);
      }
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audio.onended = () => {
        if (audioRef.current === audio) stopSpeaking();
      };
      audioRef.current = audio;
      setSpeakingIndex(idx);
      await audio.play();
    } catch (error) {
      console.error("TTS error:", error);
      stopSpeaking();
    } finally {
      setTtsLoadingIndex(null);
    }
  };

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      audioRef.current?.pause();
    };
  }, []);

  const handleCopy = async (idx: number, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex((cur) => (cur === idx ? null : cur)), 1500);
  };

  const handleEditStart = (idx: number, content: string) => {
    setEditingIndex(idx);
    setEditValue(content);
  };

  const handleEditCancel = () => {
    setEditingIndex(null);
    setEditValue("");
  };

  const handleEditSave = async (idx: number) => {
    const trimmed = editValue.trim();
    if (!trimmed || !currentConvId || loading) return;

    const convId = currentConvId;
    const apiMessages = [
      ...messages.slice(0, idx),
      { role: "user" as const, content: trimmed },
    ];

    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, messages: apiMessages } : c)),
    );
    setEditingIndex(null);
    setEditValue("");
    await getCompletion(convId, apiMessages);
  };

  const handleRegenerate = async (idx: number) => {
    if (!currentConvId || loading) return;

    const convId = currentConvId;
    // Regenerating a blocked reply retries its prompt, which goes back
    // through the guardrails.
    const apiMessages = messages
      .slice(0, idx)
      .map((m, i) => (i === idx - 1 ? { ...m, excluded: false } : m));

    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, messages: apiMessages } : c)),
    );
    await getCompletion(convId, apiMessages, true);
  };

  const handleFeedback = async (idx: number, type: "up" | "down") => {
    if (!currentConvId) return;
    const convId = currentConvId;
    const targetMessage = messages[idx];
    const newFeedback = targetMessage.feedback === type ? null : type;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map((m, i) =>
                i === idx ? { ...m, feedback: newFeedback } : m,
              ),
            }
          : c,
      ),
    );

    if (!newFeedback) return;

    const promptMessage = messages[idx - 1];
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptMessage?.content ?? "",
          response: targetMessage.content,
          feedback: newFeedback,
        }),
      });
    } catch (error) {
      console.error("Failed to save feedback:", error);
    }
  };

  const modelLabel =
    AVAILABLE_MODELS.find((m) => m.id === model)?.label ?? model;
  const backendLabel =
    retrieval === "graph"
      ? "LightRAG knowledge graph"
      : (VECTOR_STORES.find((s) => s.id === vectorStore)?.label ?? vectorStore);

  return (
    <div className="flex h-screen bg-slate-50 text-gray-900">
      {/* Sidebar: conversations plus every chat/retrieval setting */}
      <aside
        className={`transition-all duration-300 flex-shrink-0 bg-slate-900 text-slate-200 overflow-hidden ${
          sidebarOpen ? "w-72" : "w-0"
        }`}
      >
        <div className="w-72 h-full flex flex-col">
          <div className="px-4 pt-4 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Sparkles size={16} className="text-white" />
              </div>
              <span className="font-semibold text-white tracking-tight">
                My Gemini App
              </span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              className="p-1.5 rounded-md text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>

          <div className="px-4 pb-4">
            <button
              onClick={startNewChat}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              <Plus size={16} />
              New chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-5">
            <section>
              <SidebarLabel>Mode</SidebarLabel>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  {
                    id: "chat",
                    label: "Chat",
                    icon: <MessageSquare size={14} />,
                  },
                  {
                    id: "rag",
                    label: "Document Q&A",
                    icon: <FileText size={14} />,
                  },
                ]}
              />
            </section>

            {mode === "chat" ? (
              <section>
                <SidebarLabel>Model</SidebarLabel>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className={sidebarSelectClass}
                >
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </section>
            ) : (
              <>
                <section>
                  <SidebarLabel>Retrieval</SidebarLabel>
                  <Segmented
                    value={retrieval}
                    onChange={setRetrieval}
                    options={[
                      { id: "vector", label: "Vector DB" },
                      { id: "graph", label: "Knowledge graph" },
                    ]}
                  />
                </section>

                {retrieval === "vector" ? (
                  <>
                    <section>
                      <SidebarLabel>Vector store</SidebarLabel>
                      <select
                        value={vectorStore}
                        onChange={(e) =>
                          setVectorStore(e.target.value as VectorStore)
                        }
                        title="Vector store used for uploads and questions"
                        className={sidebarSelectClass}
                      >
                        {VECTOR_STORES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </section>
                    <SwitchRow
                      label="Rerank results"
                      hint="Retrieve extra chunks and reorder them with a reranker"
                      checked={rerank}
                      onChange={setRerank}
                    />
                  </>
                ) : (
                  <p className="text-xs leading-relaxed text-slate-400">
                    LightRAG in hybrid mode: entities and their neighbours plus
                    relationships and themes.
                  </p>
                )}

                <section>
                  <SidebarLabel>Documents</SidebarLabel>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileSelected}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 text-sm text-slate-200 hover:bg-slate-800 hover:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {uploading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <CloudUpload size={16} />
                    )}
                    {uploading
                      ? "Uploading..."
                      : `Upload PDF to ${backendLabel.split(" ")[0]}`}
                  </button>
                  {uploadStatus && (
                    <p
                      className={`mt-2 text-xs leading-relaxed ${
                        uploadStatus.kind === "success"
                          ? "text-emerald-400"
                          : uploadStatus.kind === "progress"
                            ? "text-slate-400"
                            : "text-red-400"
                      }`}
                    >
                      {uploadStatus.message}
                    </p>
                  )}
                </section>
              </>
            )}

            <SwitchRow
              label="Guardrails"
              hint="Check prompts with Prompt Guard and Llama Guard, and replies with Llama Guard"
              icon={<ShieldCheck size={15} />}
              checked={guardrails}
              onChange={setGuardrails}
            />

            {conversations.length > 0 && (
              <section className="pt-1">
                <SidebarLabel>Recent</SidebarLabel>
                <div className="space-y-0.5">
                  {[...conversations].reverse().map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => setCurrentConvId(conv.id)}
                      className={`w-full text-left px-2.5 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                        currentConvId === conv.id
                          ? "bg-slate-800 text-white"
                          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                      }`}
                    >
                      <MessageCircle size={14} className="flex-shrink-0" />
                      <span className="truncate">{conv.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-800 space-y-0.5">
            {process.env.NODE_ENV === "development" && (
              <Link href="/dev/cache" className={sidebarFooterClass}>
                <Database size={16} />
                Response cache
              </Link>
            )}
            <button className={sidebarFooterClass}>
              <HelpCircle size={16} />
              Help & FAQ
            </button>
            <button className={sidebarFooterClass}>
              <Settings size={16} />
              Settings
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 flex-shrink-0 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
          <div className="h-full px-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {!sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  title="Show sidebar"
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Menu size={20} className="text-gray-700" />
                </button>
              )}
              <h1 className="font-medium text-gray-900 truncate">
                {currentConv?.title ?? "New chat"}
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-xs text-gray-600 whitespace-nowrap">
                {mode === "chat" ? (
                  <MessageSquare size={12} />
                ) : (
                  <FileText size={12} />
                )}
                {mode === "chat" ? modelLabel : backendLabel}
              </span>
              {guardrails && (
                <span
                  title="Guardrails are on"
                  className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-xs text-emerald-700 whitespace-nowrap"
                >
                  <ShieldCheck size={12} />
                  Guarded
                </span>
              )}
            </div>
            {mode === "chat" && !paramsOpen && (
              <button
                onClick={() => setParamsOpen(true)}
                title="Show parameters"
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <PanelRightOpen size={20} className="text-gray-700" />
              </button>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto w-full px-4 py-8">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center min-h-[55vh]">
                <div className="w-14 h-14 mb-5 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                  {mode === "chat" ? (
                    <Sparkles size={26} className="text-white" />
                  ) : (
                    <FileText size={26} className="text-white" />
                  )}
                </div>
                <h2 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">
                  {mode === "chat"
                    ? "How can I help you today?"
                    : "Ask your documents"}
                </h2>
                <p className="text-gray-500 max-w-md">
                  {mode === "chat"
                    ? `Chatting with ${modelLabel}. Tune the model from the parameters panel.`
                    : `Upload a PDF from the sidebar, then ask questions answered from ${backendLabel}.`}
                </p>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`group flex gap-3 py-4 animate-in ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.role === "assistant" && <AssistantAvatar />}
                <div
                  className={`max-w-[85%] flex flex-col ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  {editingIndex === idx ? (
                    <div className="w-full min-w-[280px]">
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        rows={3}
                        autoFocus
                        className="w-full p-3 border border-gray-300 rounded-xl bg-white text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <div className="flex gap-2 mt-2 justify-end">
                        <button
                          onClick={handleEditCancel}
                          className="px-3 py-1.5 text-sm rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleEditSave(idx)}
                          disabled={!editValue.trim() || loading}
                          className="px-3 py-1.5 text-sm rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {msg.blocked ? (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 leading-relaxed">
                          <ShieldAlert
                            size={18}
                            className="flex-shrink-0 mt-0.5"
                          />
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      ) : msg.role === "user" ? (
                        <p
                          className={`px-4 py-2.5 rounded-2xl rounded-br-md leading-relaxed whitespace-pre-wrap ${
                            msg.excluded
                              ? "bg-gray-200 text-gray-500"
                              : "bg-blue-600 text-white"
                          }`}
                        >
                          {msg.content}
                        </p>
                      ) : (
                        <p className="pt-1 leading-relaxed whitespace-pre-wrap text-gray-900">
                          {msg.content}
                        </p>
                      )}
                      {msg.excluded && (
                        <span className="mt-1 text-xs text-gray-400">
                          Blocked, not sent to the model
                        </span>
                      )}
                      <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {msg.role === "user" ? (
                          <>
                            <button
                              onClick={() => handleCopy(idx, msg.content)}
                              title="Copy"
                              className={actionButtonClass}
                            >
                              {copiedIndex === idx ? (
                                <Check size={14} />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                            <button
                              onClick={() => handleEditStart(idx, msg.content)}
                              title="Edit"
                              className={actionButtonClass}
                            >
                              <Pencil size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleFeedback(idx, "up")}
                              title="Good response"
                              className={`${actionButtonClass} ${
                                msg.feedback === "up" ? "!text-blue-600" : ""
                              }`}
                            >
                              <ThumbsUp size={14} />
                            </button>
                            <button
                              onClick={() => handleFeedback(idx, "down")}
                              title="Bad response"
                              className={`${actionButtonClass} ${
                                msg.feedback === "down" ? "!text-blue-600" : ""
                              }`}
                            >
                              <ThumbsDown size={14} />
                            </button>
                            <button
                              onClick={() => handleSpeak(idx, msg.content)}
                              disabled={ttsLoadingIndex === idx || !msg.content}
                              title={
                                speakingIndex === idx
                                  ? "Stop reading"
                                  : "Read aloud"
                              }
                              className={`${actionButtonClass} disabled:cursor-wait ${
                                speakingIndex === idx ? "!text-blue-600" : ""
                              }`}
                            >
                              {ttsLoadingIndex === idx ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : speakingIndex === idx ? (
                                <Square size={14} />
                              ) : (
                                <Volume2 size={14} />
                              )}
                            </button>
                            <button
                              onClick={() => handleRegenerate(idx)}
                              disabled={loading}
                              title="Regenerate response"
                              className={`${actionButtonClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                            >
                              <RotateCw size={14} />
                            </button>
                            <button
                              onClick={() => handleCopy(idx, msg.content)}
                              title="Copy"
                              className={actionButtonClass}
                            >
                              {copiedIndex === idx ? (
                                <Check size={14} />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                            {msg.cached && (
                              <span
                                title="Served from the response cache. Regenerate for a fresh answer."
                                className="ml-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-500"
                              >
                                Cached
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-3 py-4 animate-in">
                <AssistantAvatar />
                <div className="flex items-center gap-1.5 pt-1">
                  {[0, 0.15, 0.3].map((delay) => (
                    <div
                      key={delay}
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${delay}s` }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="px-4 pb-4 pt-2">
          <div className="max-w-3xl mx-auto">
            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2 p-1.5 pl-5 rounded-full border border-gray-200 bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-shadow"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  recording
                    ? "Listening... click the mic to stop"
                    : transcribing
                      ? "Transcribing..."
                      : mode === "rag"
                        ? "Ask about your documents"
                        : "Message Gemini"
                }
                disabled={loading}
                className="flex-1 min-w-0 py-2 bg-transparent text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                disabled={transcribing || (loading && !recording)}
                title={recording ? "Stop recording" : "Speak your message"}
                className={`p-2.5 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  recording
                    ? "bg-red-600 text-white animate-pulse"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {transcribing ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : recording ? (
                  <Square size={18} />
                ) : (
                  <Mic size={18} />
                )}
              </button>
              <button
                type="submit"
                disabled={loading || recording || transcribing || !input.trim()}
                title="Send"
                className="p-2.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowUp size={18} />
              </button>
            </form>
            {voiceError ? (
              <p className="mt-2 text-center text-xs text-red-600">
                {voiceError}
              </p>
            ) : (
              <p className="mt-2 text-center text-xs text-gray-400">
                AI responses can be inaccurate. Verify important information.
              </p>
            )}
          </div>
        </div>
      </div>

      {mode === "chat" && paramsOpen && (
        <ModelSettingsPanel
          params={modelParams}
          onChange={setModelParams}
          onClose={() => setParamsOpen(false)}
        />
      )}
    </div>
  );
}

const sidebarSelectClass =
  "w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

const sidebarFooterClass =
  "w-full text-left flex items-center gap-3 px-2.5 py-2 rounded-md text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors";

const actionButtonClass =
  "p-1.5 rounded-md text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors";

function SidebarLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </h3>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="flex p-1 rounded-lg bg-slate-800">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
            value === o.id
              ? "bg-slate-600 text-white shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  icon,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div title={hint} className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-slate-200">
        {icon}
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-emerald-500" : "bg-slate-700"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
      <Sparkles size={15} className="text-white" />
    </div>
  );
}
