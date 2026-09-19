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
} from "lucide-react";
import ModelSettingsPanel, {
  DEFAULT_MODEL_PARAMS,
  ModelParams,
} from "./ModelSettingsPanel";

interface Message {
  role: "user" | "assistant";
  content: string;
  feedback?: "up" | "down" | null;
}

interface RagSource {
  source: string;
  page: number | null;
}

type ChatMode = "chat" | "rag";

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
  const [model, setModel] = useState(AVAILABLE_MODELS[0].id);
  const [modelParams, setModelParams] =
    useState<ModelParams>(DEFAULT_MODEL_PARAMS);
  const [paramsOpen, setParamsOpen] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setUploadStatus(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/rag-ingest", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Upload failed");
      }

      setUploadStatus({
        kind: "success",
        message: `Ingested "${data.filename}": ${data.pages} pages, ${data.chunks} chunks.`,
      });
    } catch (error) {
      setUploadStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Upload failed",
      });
    } finally {
      setUploading(false);
    }
  };

  const getRagCompletion = async (convId: string, apiMessages: Message[]) => {
    const response = await fetch("/api/rag-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: apiMessages }),
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

    const data: { text: string; sources: RagSource[] } = await response.json();

    const pageLabels = Array.from(
      new Set(
        (data.sources ?? [])
          .map((s) => (s.page != null ? `p. ${s.page}` : null))
          .filter((label): label is string => label !== null),
      ),
    );
    const content = pageLabels.length
      ? `${data.text}\n\nSources: ${pageLabels.join(", ")}`
      : data.text;

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

  const getCompletion = async (convId: string, apiMessages: Message[]) => {
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
          messages: apiMessages,
          model,
          params: requestParams,
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
                    { role: "assistant", content: "", feedback: null },
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
    const apiMessages = messages.slice(0, idx);

    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, messages: apiMessages } : c)),
    );
    await getCompletion(convId, apiMessages);
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

  const suggestedPrompts = [
    "Explain quantum computing",
    "Write a Python function",
    "Plan a trip to Japan",
    "Summarize a topic",
  ];

  return (
    <div className="flex h-screen bg-gradient-to-br from-blue-100 via-blue-50 to-white">
      {/* Sidebar */}
      <div
        className={`transition-all duration-300 flex flex-col bg-white border-r border-gray-200 ${
          sidebarOpen ? "w-64" : "w-0"
        } overflow-hidden`}
      >
        <div className="p-4 border-b border-gray-200">
          <button
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors font-medium"
          >
            <Plus size={18} />
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setCurrentConvId(conv.id)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors text-sm ${
                  currentConvId === conv.id
                    ? "bg-gray-200 text-gray-900 font-medium"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageCircle size={16} />
                  <span className="truncate">{conv.title}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-gray-200 space-y-2">
          <button className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 text-sm transition-colors">
            <HelpCircle size={18} />
            Help & FAQ
          </button>
          <button className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 text-sm transition-colors">
            <Settings size={18} />
            Settings
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 bg-white bg-opacity-80 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Menu size={20} className="text-gray-700" />
              </button>
              <h1 className="text-2xl font-semibold text-gray-900">
                My Gemini App
              </h1>
              <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                <button
                  onClick={() => setMode("chat")}
                  className={`px-3 py-1.5 transition-colors ${
                    mode === "chat"
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setMode("rag")}
                  className={`px-3 py-1.5 transition-colors ${
                    mode === "rag"
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Document Q&A
                </button>
              </div>
              {mode === "chat" && (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
              {mode === "rag" && (
                <>
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <CloudUpload size={16} />
                    {uploading ? "Uploading..." : "Upload PDF"}
                  </button>
                </>
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
          {mode === "rag" && uploadStatus && (
            <div
              className={`max-w-4xl mx-auto px-4 pb-3 text-sm ${
                uploadStatus.kind === "success"
                  ? "text-green-700"
                  : "text-red-600"
              }`}
            >
              {uploadStatus.message}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto w-full px-4 py-8">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
                <h2 className="text-3xl font-semibold text-gray-900 mb-2">
                  Hello there
                </h2>
                <p className="text-gray-600 mb-8">How can I help you today?</p>

                <div className="grid grid-cols-2 gap-3 w-full max-w-2xl">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => setInput(prompt)}
                      className="p-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-left transition-colors"
                    >
                      <p className="text-gray-900 text-sm font-medium">
                        {prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`group flex gap-4 py-6 animate-in fade-in ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-lg">
                    🤖
                  </div>
                )}
                <div
                  className={`max-w-2xl flex flex-col ${
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
                        className="w-full p-3 border border-gray-300 rounded-lg text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                      <p className="text-gray-900 leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </p>
                      <div className="flex items-center gap-1 mt-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                        {msg.role === "user" ? (
                          <>
                            <button
                              onClick={() => handleCopy(idx, msg.content)}
                              title="Copy"
                              className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 transition-colors"
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
                              className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 transition-colors"
                            >
                              <Pencil size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleFeedback(idx, "up")}
                              title="Good response"
                              className={`p-1.5 rounded-md hover:bg-gray-200 transition-colors ${
                                msg.feedback === "up"
                                  ? "text-blue-600"
                                  : "text-gray-500"
                              }`}
                            >
                              <ThumbsUp size={14} />
                            </button>
                            <button
                              onClick={() => handleFeedback(idx, "down")}
                              title="Bad response"
                              className={`p-1.5 rounded-md hover:bg-gray-200 transition-colors ${
                                msg.feedback === "down"
                                  ? "text-blue-600"
                                  : "text-gray-500"
                              }`}
                            >
                              <ThumbsDown size={14} />
                            </button>
                            <button
                              onClick={() => handleRegenerate(idx)}
                              disabled={loading}
                              title="Regenerate response"
                              className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              <RotateCw size={14} />
                            </button>
                            <button
                              onClick={() => handleCopy(idx, msg.content)}
                              title="Copy"
                              className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 transition-colors"
                            >
                              {copiedIndex === idx ? (
                                <Check size={14} />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white font-semibold text-lg">
                    👤
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex gap-4 py-6 animate-in fade-in">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-lg">
                  🤖
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0.1s" }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0.2s" }}
                  ></div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="bg-white bg-opacity-80 backdrop-blur-sm border-t border-gray-200 py-4">
          <div className="max-w-4xl mx-auto px-4">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  mode === "rag" ? "Ask about the document" : "Message Gemini"
                }
                disabled={loading}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-500 disabled:bg-gray-50 disabled:cursor-not-allowed transition-all bg-white text-gray-900"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="px-6 py-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Send
              </button>
            </form>
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
