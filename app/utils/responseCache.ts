import { createHash } from "crypto";

// In-memory LRU cache for chat completions, local to this server process.
// Entries are lost on restart and aren't shared between instances.
const MAX_ENTRIES = 500;
const TTL_MS = 60 * 60 * 1000;

export interface CacheMeta {
  model: string;
  // Last user message, kept only so the dev cache viewer can show it.
  prompt: string;
  turns: number;
}

interface CacheEntry extends CacheMeta {
  text: string;
  createdAt: number;
  expiresAt: number;
  hits: number;
}

export interface CacheEntrySummary extends CacheEntry {
  key: string;
}

// Kept on globalThis so dev-mode hot reloads of the route don't wipe it.
const globalForCache = globalThis as unknown as {
  chatResponseCache?: Map<string, CacheEntry>;
};
const cache = (globalForCache.chatResponseCache ??= new Map());

export function makeCacheKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function getCachedResponse(key: string): string | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  entry.hits += 1;
  // Re-insert so Map iteration order tracks recency.
  cache.delete(key);
  cache.set(key, entry);
  return entry.text;
}

export function setCachedResponse(
  key: string,
  text: string,
  meta: CacheMeta,
): void {
  const now = Date.now();
  cache.delete(key);
  cache.set(key, {
    ...meta,
    text,
    createdAt: now,
    expiresAt: now + TTL_MS,
    hits: 0,
  });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// Most recently used first; expired entries are pruned along the way.
export function listCachedResponses(): CacheEntrySummary[] {
  const now = Date.now();
  const entries: CacheEntrySummary[] = [];
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
      continue;
    }
    entries.push({ key, ...entry });
  }
  return entries.reverse();
}

export function deleteCachedResponse(key: string): boolean {
  return cache.delete(key);
}

export function clearCachedResponses(): number {
  const count = cache.size;
  cache.clear();
  return count;
}

export const CACHE_LIMITS = { maxEntries: MAX_ENTRIES, ttlMs: TTL_MS };
