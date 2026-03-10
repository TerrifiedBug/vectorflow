import type { IncomingMessage } from "http";
import { prisma } from "@/lib/prisma";
import { extractBearerToken, verifyNodeToken } from "./agent-token";

/**
 * Authenticate a WebSocket upgrade request by verifying its Bearer token
 * against all node tokens.
 *
 * Returns the matching node and environment IDs, or null if authentication fails.
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

  const nodes = await prisma.vectorNode.findMany({
    where: { nodeTokenHash: { not: null } },
    select: { id: true, environmentId: true, nodeTokenHash: true },
  });

  for (const node of nodes) {
    if (!node.nodeTokenHash) continue;
    const valid = await verifyNodeToken(token, node.nodeTokenHash);
    if (valid) {
      return { nodeId: node.id, environmentId: node.environmentId };
    }
  }

  return null;
}
