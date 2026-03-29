import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyEnrollmentToken, generateNodeToken } from "@/server/services/agent-token";
import { fireEventAlert } from "@/server/services/event-alerts";
import { debugLog } from "@/lib/logger";
import { nodeMatchesGroup } from "@/lib/node-group-utils";
import { checkIpRateLimit } from "@/app/api/_lib/ip-rate-limit";

const enrollSchema = z.object({
  token: z.string().min(1),
  hostname: z.string().min(1).max(253),
  os: z.string().max(100).optional(),
  agentVersion: z.string().max(100).optional(),
  vectorVersion: z.string().max(100).optional(),
});

export async function POST(request: Request) {
  const rateLimited = checkIpRateLimit(request, "enroll", 10);
  if (rateLimited) return rateLimited;

  try {
    const body = await request.json();
    const parsed = enrollSchema.safeParse(body);
    if (!parsed.success) {
      console.error("[enroll] invalid input:", parsed.error.flatten().fieldErrors);
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { token, hostname, os, agentVersion, vectorVersion } = parsed.data;
    const safeHostname = hostname.replace(/[\r\n\t"]/g, " ");
    const safeVersion = (agentVersion ?? "unknown").replace(/[\r\n\t"]/g, " ");
    debugLog("enroll", `attempt from hostname="${safeHostname}" agentVersion="${safeVersion}"`);

    // Find all environments that have an enrollment token
    const environments = await prisma.environment.findMany({
      where: {
        enrollmentTokenHash: { not: null },
        isSystem: false,
      },
      select: {
        id: true,
        name: true,
        enrollmentTokenHash: true,
        team: { select: { id: true } },
      },
    });
    debugLog("enroll", `found ${environments.length} candidate environment(s)`);

    // Try each environment's enrollment token
    let matchedEnv: (typeof environments)[0] | null = null;
    for (const env of environments) {
      if (env.enrollmentTokenHash && await verifyEnrollmentToken(token, env.enrollmentTokenHash)) {
        matchedEnv = env;
        break;
      }
    }

    if (!matchedEnv) {
      console.error(`[enroll] REJECTED -- no matching environment (checked ${environments.length})`);
      return NextResponse.json(
        { error: "Invalid enrollment token" },
        { status: 401 },
      );
    }

    // Generate a unique node token for this agent
    const nodeToken = await generateNodeToken();

    // Create the fleet node entry
    const node = await prisma.vectorNode.create({
      data: {
        name: hostname,
        host: hostname,
        environmentId: matchedEnv.id,
        status: "HEALTHY",
        nodeTokenHash: nodeToken.hash,
        enrolledAt: new Date(),
        lastHeartbeat: new Date(),
        agentVersion: agentVersion ?? null,
        vectorVersion: vectorVersion ?? null,
        os: os ?? null,
        metadata: { enrolledVia: "agent" },
      },
    });
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
      console.error("[enroll] label template application failed:", err);
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
    console.error("[enroll] unexpected error:", error);
    return NextResponse.json(
      { error: "Enrollment failed" },
      { status: 500 },
    );
  }
}
