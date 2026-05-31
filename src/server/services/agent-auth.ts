import { adminPrisma } from "@/lib/prisma";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";
import {
  extractBearerToken,
  getNodeTokenIdentifier,
  verifyNodeToken,
} from "./agent-token";
import { warnLog } from "@/lib/logger";

export interface AgentIdentity {
  nodeId: string;
  environmentId: string;
}

// ─── Org-scoped authentication (primary path) ─────────────────────────────────

/**
 * Authenticate an agent request within a specific organization.
 *
 * All DB queries are scoped to `orgId` so a token from Org A can never
 * authenticate against Org B's nodes, even if the token itself is valid.
 *
 * Use after `resolveAgentOrg` has established the org context:
 * ```ts
 * const orgResult = await resolveAgentOrg(request);
 * if (orgResult instanceof Response) return orgResult;
 * const agent = await authenticateAgentInOrg(request, orgResult.orgId);
 * ```
 */
export async function authenticateAgentInOrg(
  request: Request,
  orgId: string,
): Promise<AgentIdentity | null> {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) return null;

  const tokenId = getNodeTokenIdentifier(token);

  if (tokenId) {
    return authenticateByIndexInOrg(token, tokenId, orgId);
  }

  // Legacy token (no embedded identifier) — scan only this org's un-migrated nodes.
  return authenticateLegacyInOrg(token, orgId);
}

async function authenticateByIndexInOrg(
  token: string,
  tokenId: string,
  orgId: string,
): Promise<AgentIdentity | null> {
  const node = await adminPrisma.vectorNode.findFirst({
    where: {
      nodeTokenId: tokenId,
      organizationId: orgId,  // hard org boundary — never cross-tenant
    },
    select: { id: true, environmentId: true, nodeTokenHash: true },
  });

  if (!node?.nodeTokenHash) return null;

  const valid = await verifyNodeToken(token, node.nodeTokenHash);
  return valid ? { nodeId: node.id, environmentId: node.environmentId } : null;
}

async function authenticateLegacyInOrg(
  token: string,
  orgId: string,
): Promise<AgentIdentity | null> {
  // Legacy tokens don't have an identifier, so we must scan.
  // We scope to this org's un-migrated nodes to keep the blast radius bounded.
  const nodes = await adminPrisma.vectorNode.findMany({
    where: {
      nodeTokenHash: { not: null },
      nodeTokenId: null,
      organizationId: orgId,  // scoped to org — not fleet-wide
    },
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

// ─── Legacy fleet-wide authentication (OSS backward-compat only) ─────────────

/**
 * @deprecated Use `authenticateAgentInOrg` instead.
 *
 * Fleet-wide authentication with no org scope. Retained for backward
 * compatibility while agents are being migrated to slug-prefixed tokens.
 * Not called when X-VF-Org-Slug-based org resolution is active.
 */
export async function authenticateAgent(
  request: Request,
): Promise<AgentIdentity | null> {
  warnLog(
    "agent-auth",
    "authenticateAgent called without org scope — use authenticateAgentInOrg",
  );
  return authenticateAgentInOrg(request, DEFAULT_ORG_ID);
}
