import type { IncomingMessage } from "http";
import { prisma } from "@/lib/prisma";
import { extractBearerToken, verifyNodeToken } from "./agent-token";

/** Cache verified tokens to avoid O(n) bcrypt scan on every WS upgrade.
 *  Key: plaintext token, Value: { nodeId, environmentId }.
 *  Entries are evicted when the token fails verification (node re-enrolled). */
const tokenCache = new Map<string, { nodeId: string; environmentId: string }>();

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
  const cached = tokenCache.get(token);
  if (cached) {
    // Verify the node still exists and the hash still matches (re-enrollment invalidates)
    const node = await prisma.vectorNode.findUnique({
      where: { id: cached.nodeId },
      select: { nodeTokenHash: true },
    });
    if (node?.nodeTokenHash && await verifyNodeToken(token, node.nodeTokenHash)) {
      return cached;
    }
    // Cache stale — node deleted or re-enrolled
    tokenCache.delete(token);
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
      const result = { nodeId: node.id, environmentId: node.environmentId };
      tokenCache.set(token, result);
      return result;
    }
  }

  return null;
}
