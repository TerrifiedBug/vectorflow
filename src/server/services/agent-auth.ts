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
  if (!tokenId) {
    return null;
  }

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
