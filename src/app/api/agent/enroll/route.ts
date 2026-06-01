export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonCapped } from "@/app/api/_lib/read-json-capped";
import { prisma } from "@/lib/prisma";
import { runWithOrgContext } from "@/lib/org-context";
import {
  verifyEnrollmentToken,
  generateNodeToken,
  getEnrollmentTokenIdentifier,
} from "@/server/services/agent-token";
import { resolveAgentOrg } from "@/server/services/agent-org-binding";
import { fireEventAlert } from "@/server/services/event-alerts";
import { debugLog, errorLog, warnLog } from "@/lib/logger";
import { nodeMatchesGroup } from "@/lib/node-group-utils";
import { checkIpRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { isDemoMode } from "@/lib/is-demo-mode";
import { withQuotaCheck } from "@/server/services/quotas";

const enrollSchema = z.object({
  token: z.string().min(1),
  hostname: z.string().min(1).max(253),
  os: z.string().max(100).optional(),
  agentVersion: z.string().max(100).optional(),
  vectorVersion: z.string().max(100).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: Request) {
  if (isDemoMode()) {
    return NextResponse.json(
      { error: "Agent enrollment is disabled in the public demo." },
      { status: 403 },
    );
  }

  const rateLimited = await checkIpRateLimit(request, "enroll", 10);
  if (rateLimited) return rateLimited;

  // Parse the body first — enrollment tokens are in the body, not the
  // Authorization header. resolveAgentOrg needs the explicit token for
  // slug extraction and legacy-token detection.
  const read = await readJsonCapped(request);
  if (!read.ok) return read.response;
  const parsed = enrollSchema.safeParse(read.data);
  if (!parsed.success) {
    errorLog("enroll", "invalid input", parsed.error.flatten().fieldErrors);
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const orgResult = await resolveAgentOrg(request, { explicitToken: parsed.data.token });
  if (orgResult instanceof Response) return orgResult;

  if (orgResult.isLegacyToken) {
    warnLog("enroll", "enrollment via legacy (pre-slug) token — consider regenerating");
  }

  return runWithOrgContext(orgResult.orgId, async () => {
  try {

    const { token, hostname, os, agentVersion, vectorVersion, labels: agentLabels } = parsed.data;
    const safeHostname = hostname.replace(/[\r\n\t"]/g, " ");
    const safeVersion = (agentVersion ?? "unknown").replace(/[\r\n\t"]/g, " ");
    debugLog("enroll", `attempt from hostname="${safeHostname}" agentVersion="${safeVersion}"`);

    // VF-36: when the token embeds a stable identifier, look up the single
    // candidate environment by its indexed enrollmentTokenId so we bcrypt-verify
    // exactly one row instead of fanning out over every environment in the org.
    // Legacy / no-id tokens fall back to the per-environment scan below.
    const tokenIdentifier = getEnrollmentTokenIdentifier(token);

    const envSelect = {
      id: true,
      name: true,
      enrollmentTokenHash: true,
      team: { select: { id: true } },
    } as const;

    let matchedEnv:
      | { id: string; name: string; enrollmentTokenHash: string | null; team: { id: string } | null }
      | null = null;

    if (tokenIdentifier) {
      const candidate = await prisma.environment.findFirst({
        where: {
          enrollmentTokenId: tokenIdentifier,
          enrollmentTokenHash: { not: null },
          isSystem: false,
          organizationId: orgResult.orgId,
        },
        select: envSelect,
      });
      if (
        candidate?.enrollmentTokenHash &&
        (await verifyEnrollmentToken(token, candidate.enrollmentTokenHash))
      ) {
        matchedEnv = candidate;
      }
    } else {
      // Legacy / no-identifier token: scan every environment that has a token.
      const environments = await prisma.environment.findMany({
        where: {
          enrollmentTokenHash: { not: null },
          isSystem: false,
          organizationId: orgResult.orgId,
        },
        select: envSelect,
      });
      debugLog("enroll", `found ${environments.length} candidate environment(s)`);

      for (const env of environments) {
        if (env.enrollmentTokenHash && await verifyEnrollmentToken(token, env.enrollmentTokenHash)) {
          matchedEnv = env;
          break;
        }
      }
    }

    if (!matchedEnv) {
      errorLog(
        "enroll",
        `REJECTED -- no matching environment (lookup=${tokenIdentifier ? "by-id" : "scan"})`,
      );
      return NextResponse.json(
        { error: "Invalid enrollment token" },
        { status: 401 },
      );
    }

    // Generate a unique node token for this agent
    const nodeToken = await generateNodeToken(orgResult.orgSlug);

    // Create the fleet node entry with agent-provided labels so group matching
    // can use them immediately (fixes the chicken-and-egg problem where nodes
    // enrolled with no labels could never match groups with specific criteria).
    // Per-org plan-tier quota gate. Wrap the node insert in the
    // (advisory-lock + pre-count + post-count) helper so the FREE/PRO
    // `agents` limit is honoured even under concurrent enrollment requests.
    // On exceed we surface 402 + the structured envelope; the agent retry
    // loop must treat this as terminal (no retry).
    let node;
    try {
      node = await withQuotaCheck(orgResult.orgId, "agents", (tx) =>
        tx.vectorNode.create({
          data: {
            name: hostname,
            host: hostname,
            environmentId: matchedEnv.id,
            status: "HEALTHY",
            nodeTokenHash: nodeToken.hash,
            nodeTokenId: nodeToken.identifier,
            enrolledAt: new Date(),
            lastHeartbeat: new Date(),
            agentVersion: agentVersion ?? null,
            vectorVersion: vectorVersion ?? null,
            os: os ?? null,
            metadata: { enrolledVia: "agent" },
            organizationId: orgResult.orgId,
            ...(agentLabels && Object.keys(agentLabels).length > 0
              ? { labels: agentLabels }
              : {}),
          },
        }),
      );
    } catch (err) {
      // Duck-type the QuotaExceededError so cross-module class identity
      // (Vitest module isolation, dual-bundling) cannot defeat the gate.
      // `name === "QuotaExceededError"` plus the typed payload fields is
      // part of the contract in `quotas.ts`.
      const e = err as
        | {
            name?: unknown;
            quota?: unknown;
            plan?: unknown;
            limit?: unknown;
            current?: unknown;
            organizationId?: unknown;
          }
        | null
        | undefined;

      if (
        e &&
        typeof e === "object" &&
        e.name === "QuotaExceededError" &&
        typeof e.quota === "string"
      ) {
        warnLog(
          "enroll",
          `REJECTED -- org ${String(e.organizationId)} (${String(e.plan)}) at ${String(e.current)}/${String(e.limit)} ${String(e.quota)}`,
        );
        return NextResponse.json(
          {
            error: "Plan limit reached",
            quota: e.quota,
            plan: e.plan,
            limit: e.limit,
            current: e.current,
            upgradeUrl: "https://vectorflow.sh/pricing",
          },
          { status: 402 },
        );
      }
      throw err;
    }
    // NODE-03: Auto-apply matching NodeGroup label templates
    try {
      const nodeGroups = await prisma.nodeGroup.findMany({
        where: { environmentId: matchedEnv.id },
      });

      const mergedLabels: Record<string, string> = {};
      for (const group of nodeGroups) {
        const criteria = group.criteria as Record<string, string>;
        const nodeLabels = (node.labels as Record<string, string>) ?? {};
        if (nodeMatchesGroup(nodeLabels, criteria)) {
          Object.assign(mergedLabels, group.labelTemplate as Record<string, string>);
        }
      }

      if (Object.keys(mergedLabels).length > 0) {
        await prisma.vectorNode.update({
          where: { id: node.id },
          data: {
            labels: {
              ...((node.labels as Record<string, string>) ?? {}),
              ...mergedLabels,
            },
          },
        });
      }
    } catch (err) {
      // Non-fatal: enrollment still succeeds even if label template application fails
      errorLog("enroll", "label template application failed", err);
    }

    debugLog("enroll", `SUCCESS -- node ${node.id} enrolled in "${matchedEnv.name}"`);

    await prisma.nodeStatusEvent.create({
      data: {
        nodeId: node.id,
        fromStatus: null,
        toStatus: "HEALTHY",
        reason: "enrolled",
      },
    });

    void fireEventAlert("node_joined", matchedEnv.id, {
      message: `Node "${hostname}" enrolled in environment "${matchedEnv.name}"`,
      nodeId: node.id,
    });

    return NextResponse.json({
      nodeId: node.id,
      nodeToken: nodeToken.token,
      environmentId: matchedEnv.id,
      environmentName: matchedEnv.name,
    });
  } catch (error) {
    errorLog("enroll", "unexpected error", error);
    return NextResponse.json(
      { error: "Enrollment failed" },
      { status: 500 },
    );
  }
  });
}
