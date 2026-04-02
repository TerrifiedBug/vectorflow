// src/server/services/context7.ts
//
// Runtime Context7 documentation lookup client.
// Provides up-to-date library docs for all AI features: migration translation,
// VRL chat, pipeline debug, cost optimizer.
//
// Works without an API key (free tier ~100 req/day). Set CONTEXT7_API_KEY
// env var for higher limits. On failure, callers fall back to static docs.

import { debugLog, warnLog } from "@/lib/logger";

const TAG = "context7";
const BASE_URL = "https://context7.com/api/v2";

// Well-known library IDs — avoids a resolve call for common lookups
const LIBRARY_IDS = {
  vector: "/websites/vector_dev",
  vrl: "/websites/vector_dev_reference_vrl",
  fluentd: "/fluent/fluentd",
  vectorRepo: "/vectordotdev/vector",
} as const;

// In-memory cache: key → { text, expiry }
const cache = new Map<string, { text: string; expiry: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getApiKey(): string | null {
  return process.env.CONTEXT7_API_KEY ?? null;
}

function getCacheKey(libraryId: string, query: string): string {
  return `${libraryId}::${query}`;
}

interface Context7Snippet {
  title?: string;
  description?: string;
  code?: string;
  content?: string;
  language?: string;
}

interface Context7Response {
  codeSnippets?: Context7Snippet[];
  infoSnippets?: Context7Snippet[];
}

/**
 * Query Context7 for documentation. Returns formatted text suitable for
 * inclusion in an AI prompt. Returns empty string if API key is missing
 * or the request fails.
 */
async function queryDocs(libraryId: string, query: string): Promise<string> {
  const cacheKey = getCacheKey(libraryId, query);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    debugLog(TAG, `Cache hit: ${cacheKey}`);
    return cached.text;
  }

  try {
    const url = new URL(`${BASE_URL}/context`);
    url.searchParams.set("libraryId", libraryId);
    url.searchParams.set("query", query);
    url.searchParams.set("type", "json");

    const headers: Record<string, string> = {};
    const apiKey = getApiKey();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (!response.ok) {
      warnLog(TAG, `Context7 API error: ${response.status}`);
      return "";
    }

    const data = (await response.json()) as Context7Response;
    const text = formatResponse(data);

    cache.set(cacheKey, { text, expiry: Date.now() + CACHE_TTL_MS });
    debugLog(TAG, `Fetched docs for ${libraryId}: ${text.length} chars`);
    return text;
  } catch (err) {
    warnLog(TAG, `Context7 lookup failed: ${err instanceof Error ? err.message : "unknown"}`);
    return "";
  }
}

function formatResponse(data: Context7Response): string {
  const parts: string[] = [];

  if (data.codeSnippets) {
    for (const snippet of data.codeSnippets.slice(0, 3)) {
      if (snippet.title) parts.push(`### ${snippet.title}`);
      if (snippet.description) parts.push(snippet.description);
      if (snippet.code) {
        parts.push(`\`\`\`${snippet.language ?? ""}`);
        parts.push(snippet.code);
        parts.push("```");
      }
      parts.push("");
    }
  }

  if (data.infoSnippets) {
    for (const snippet of data.infoSnippets.slice(0, 2)) {
      if (snippet.content) parts.push(snippet.content);
      parts.push("");
    }
  }

  return parts.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Public API — targeted lookups for AI features
// ---------------------------------------------------------------------------

/**
 * Look up Vector component documentation for a specific component type.
 * Used by: all AI features (migration, VRL chat, debug, cost optimizer).
 */
export async function lookupVectorComponent(
  componentType: string,
  kind: "source" | "transform" | "sink",
): Promise<string> {
  const query = `Vector ${kind} "${componentType}" configuration fields YAML example`;
  const text = await queryDocs(LIBRARY_IDS.vector, query);
  return text ? `=== Vector ${kind}: ${componentType} (from docs) ===\n${text}` : "";
}

/**
 * Look up VRL function documentation for a specific operation.
 * Used by: VRL chat, debug chat, migration (Ruby→VRL translation).
 */
export async function lookupVrlFunction(operation: string): Promise<string> {
  const text = await queryDocs(LIBRARY_IDS.vrl, operation);
  return text ? `=== VRL Reference ===\n${text}` : "";
}

/**
 * Look up FluentD plugin documentation for a specific plugin.
 * Used by: migration AI translator (understanding source format).
 */
export async function lookupFluentdPlugin(pluginType: string): Promise<string> {
  const query = `FluentD plugin "${pluginType}" configuration parameters example`;
  const text = await queryDocs(LIBRARY_IDS.fluentd, query);
  return text ? `=== FluentD plugin: ${pluginType} (from docs) ===\n${text}` : "";
}

/**
 * Look up docs for a set of Vector components (batch).
 * Deduplicates and runs in parallel. Used by: pipeline review, cost optimizer.
 */
export async function lookupPipelineComponents(
  components: Array<{ componentType: string; kind: "source" | "transform" | "sink" }>,
): Promise<string> {
  const seen = new Set<string>();
  const lookups: Promise<string>[] = [];

  for (const { componentType, kind } of components) {
    const key = `${kind}:${componentType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lookups.push(lookupVectorComponent(componentType, kind));
  }

  const results = await Promise.all(lookups);
  return results.filter(Boolean).join("\n\n");
}

/**
 * Check if Context7 has an API key configured (higher rate limits).
 * Context7 works without a key (free tier ~100 req/day), but an API key
 * from context7.com/dashboard removes the limit.
 */
export function isContext7Configured(): boolean {
  return getApiKey() !== null;
}
