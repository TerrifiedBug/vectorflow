import { prisma } from "@/lib/prisma";
import {
  extractBearerToken,
  getNodeTokenIdentifier,
  verifyNodeToken,
} from "./agent-token";

/**
 * Authenticate an incoming agent request by using the token's stable
 * identifier to fetch one candidate node, then verifying that node's hash.
 *
 * Legacy tokens that lack an identifier fall back to scanning nodes that
 * have not yet been migrated (nodeTokenId IS NULL). This keeps pre-existing
 * agents working during the rollout while limiting the scan surface.
 *
 * Returns the matching node and environment IDs, or null if authentication fails.
 */
export async function authenticateAgent(
  request: Request,
): Promise<{ nodeId: string; environmentId: string } | null> {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return null;
  }

  const tokenId = getNodeTokenIdentifier(token);

  if (tokenId) {
    return authenticateByIndex(token, tokenId);
  }

  // Legacy token — fall back to scanning un-migrated nodes
  return authenticateLegacy(token);
}

async function authenticateByIndex(
  token: string,
  tokenId: string,
): Promise<{ nodeId: string; environmentId: string } | null> {
  const node = await prisma.vectorNode.findUnique({
    where: { nodeTokenId: tokenId },
    select: {
      id: true,
      environmentId: true,
      nodeTokenHash: true,
    },
  });

  if (!node?.nodeTokenHash) {
    return null;
  }

  const valid = await verifyNodeToken(token, node.nodeTokenHash);
  return valid ? { nodeId: node.id, environmentId: node.environmentId } : null;
}

async function authenticateLegacy(
  token: string,
): Promise<{ nodeId: string; environmentId: string } | null> {
  const nodes = await prisma.vectorNode.findMany({
    where: {
      nodeTokenHash: { not: null },
      nodeTokenId: null,
    },
    select: {
      id: true,
      environmentId: true,
      nodeTokenHash: true,
    },
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
