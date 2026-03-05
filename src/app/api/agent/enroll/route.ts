import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyEnrollmentToken, generateNodeToken } from "@/server/services/agent-token";

const enrollSchema = z.object({
  token: z.string().min(1),
  hostname: z.string().min(1).max(253),
  os: z.string().max(100).optional(),
  agentVersion: z.string().max(100).optional(),
  vectorVersion: z.string().max(100).optional(),
});

export async function POST(request: Request) {
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
    console.log(`[enroll] attempt from hostname="${safeHostname}" agentVersion="${safeVersion}"`);

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
    console.log(`[enroll] found ${environments.length} candidate environment(s)`);

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
    console.log(`[enroll] SUCCESS -- node ${node.id} enrolled in "${matchedEnv.name}"`);

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
