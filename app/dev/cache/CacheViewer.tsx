"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCw, Trash2, ChevronDown } from "lucide-react";

interface CacheEntry {
  key: string;
  model: string;
  prompt: string;
  turns: number;
  text: string;
  createdAt: number;
  expiresAt: number;
  hits: number;
}

interface CacheResponse {
  entries: CacheEntry[];
  limits: { maxEntries: number; ttlMs: number };
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function CacheViewer() {
  const [data, setData] = useState<CacheResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/cache", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cache");
    } finally {
      setNow(Date.now());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(tick);
    };
  }, [load]);

  const remove = async (key?: string) => {
    const url = key
      ? `/api/cache?key=${encodeURIComponent(key)}`
      : "/api/cache";
    await fetch(url, { method: "DELETE" });
    setConfirmClear(false);
    await load();
  };

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const query = filter.trim().toLowerCase();
  const entries = (data?.entries ?? []).filter(
    (e) =>
      !query ||
      e.prompt.toLowerCase().includes(query) ||
      e.text.toLowerCase().includes(query) ||
      e.model.toLowerCase().includes(query),
  );
  const totalHits = (data?.entries ?? []).reduce((n, e) => n + e.hits, 0);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          Back to chat
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Response cache</h1>
            <p className="mt-1 text-sm text-gray-600">
              In-memory cache of chat completions in this dev server process.
              {data &&
                ` Up to ${data.limits.maxEntries} entries, each kept for ${formatDuration(data.limits.ttlMs)}.`}
            </p>
          </div>
          <span className="px-2 py-1 rounded bg-amber-100 text-amber-800 text-xs font-medium">
            Development only
          </span>
        </div>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Entries" value={data?.entries.length ?? "–"} />
          <Stat label="Total hits" value={data ? totalHits : "–"} />
          <Stat
            label="Hit entries"
            value={data ? data.entries.filter((e) => e.hits > 0).length : "–"}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by prompt, response, or model"
            className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <RotateCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          {confirmClear ? (
            <>
              <button
                onClick={() => remove()}
                className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700"
              >
                Confirm clear all
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              disabled={!data?.entries.length}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 bg-white text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={14} />
              Clear all
            </button>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 space-y-3">
          {data && entries.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500 bg-white border border-gray-200 rounded-lg">
              {data.entries.length === 0
                ? "The cache is empty. Send a message in the chat to populate it."
                : "No entries match the filter."}
            </div>
          )}

          {entries.map((e) => {
            const open = expanded.has(e.key);
            return (
              <div
                key={e.key}
                className="bg-white border border-gray-200 rounded-lg"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium break-words whitespace-pre-wrap">
                      {e.prompt || <em className="text-gray-400">(empty)</em>}
                    </p>
                    <button
                      onClick={() => remove(e.key)}
                      title="Delete entry"
                      className="flex-shrink-0 p-1.5 rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>{e.model}</span>
                    <span>
                      {e.turns} {e.turns === 1 ? "message" : "messages"} in
                      context
                    </span>
                    <span>
                      {e.hits} {e.hits === 1 ? "hit" : "hits"}
                    </span>
                    <span>cached {formatDuration(now - e.createdAt)} ago</span>
                    <span>expires in {formatDuration(e.expiresAt - now)}</span>
                    <span className="font-mono" title={e.key}>
                      {e.key.slice(0, 12)}
                    </span>
                  </div>
                  <button
                    onClick={() => toggle(e.key)}
                    className="mt-3 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${open ? "rotate-180" : ""}`}
                    />
                    {open ? "Hide response" : "Show response"}
                  </button>
                </div>
                {open && (
                  <pre className="px-4 pb-4 text-sm text-gray-800 whitespace-pre-wrap break-words font-sans border-t border-gray-100 pt-3">
                    {e.text}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-3 bg-white border border-gray-200 rounded-lg">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
    </div>
  );
}
