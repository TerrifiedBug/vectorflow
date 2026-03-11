import type { IncomingMessage } from "http";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { extractBearerToken, verifyNodeToken } from "./agent-token";

/** Fast, non-reversible hash used as cache key instead of the raw plaintext
 *  token — avoids keeping credentials in process memory. */
function tokenCacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const TOKEN_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TOKEN_CACHE_MAX_SIZE = 1000;

interface CacheEntry {
  nodeId: string;
  environmentId: string;
  cachedAt: number;
}

/** Cache verified tokens to avoid O(n) bcrypt scan on every WS upgrade.
 *  Key: SHA-256 hash of token, Value: { nodeId, environmentId, cachedAt }.
 *  Entries expire after 30 minutes and the cache is capped at 1000 entries. */
const tokenCache = new Map<string, CacheEntry>();

/** Remove expired entries. Called on each lookup to bound memory. */
function evictStale(): void {
  if (tokenCache.size <= TOKEN_CACHE_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of tokenCache) {
    if (now - entry.cachedAt > TOKEN_CACHE_TTL_MS) {
      tokenCache.delete(key);
    }
  }
}

/**
 * Authenticate a WebSocket upgrade request by verifying its Bearer token.
 *
 * Uses an in-memory cache so reconnects (same token) are O(1) instead of
 * scanning all node hashes with bcrypt.
 */
export async function authenticateWsUpgrade(
  req: IncomingMessage,
): Promise<{ nodeId: string; environmentId: string } | null> {
  const authHeader = req.headers["authorization"];
  const token = extractBearerToken(
    Array.isArray(authHeader) ? authHeader[0] : authHeader ?? null,
  );
  if (!token) {
    return null;
  }

  // Fast path: check cache first (O(1) string lookup)
  const cacheKey = tokenCacheKey(token);
  const cached = tokenCache.get(cacheKey);
  if (cached) {
    // Evict if TTL expired
    if (Date.now() - cached.cachedAt > TOKEN_CACHE_TTL_MS) {
      tokenCache.delete(cacheKey);
    } else {
      // Verify the node still exists and the hash still matches (re-enrollment invalidates)
      const node = await prisma.vectorNode.findUnique({
        where: { id: cached.nodeId },
        select: { nodeTokenHash: true },
      });
      if (node?.nodeTokenHash && await verifyNodeToken(token, node.nodeTokenHash)) {
        return { nodeId: cached.nodeId, environmentId: cached.environmentId };
      }
      // Cache stale — node deleted or re-enrolled
      tokenCache.delete(cacheKey);
    }
  }

  // Slow path: scan all nodes with bcrypt
  const nodes = await prisma.vectorNode.findMany({
    where: { nodeTokenHash: { not: null } },
    select: { id: true, environmentId: true, nodeTokenHash: true },
  });

  for (const node of nodes) {
    if (!node.nodeTokenHash) continue;
    const valid = await verifyNodeToken(token, node.nodeTokenHash);
    if (valid) {
      evictStale();
      tokenCache.set(cacheKey, {
        nodeId: node.id,
        environmentId: node.environmentId,
        cachedAt: Date.now(),
      });
      return { nodeId: node.id, environmentId: node.environmentId };
    }
  }

  return null;
}
