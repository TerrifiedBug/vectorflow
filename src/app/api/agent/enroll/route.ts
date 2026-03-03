import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyEnrollmentToken, generateNodeToken } from "@/server/services/agent-token";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, hostname, os, agentVersion, vectorVersion } = body;

    if (!token || !hostname) {
      return NextResponse.json(
        { error: "token and hostname are required" },
        { status: 400 },
      );
    }

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

    // Try each environment's enrollment token
    let matchedEnv: (typeof environments)[0] | null = null;
    for (const env of environments) {
      if (env.enrollmentTokenHash && await verifyEnrollmentToken(token, env.enrollmentTokenHash)) {
        matchedEnv = env;
        break;
      }
    }

    if (!matchedEnv) {
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

    return NextResponse.json({
      nodeId: node.id,
      nodeToken: nodeToken.token,
      environmentId: matchedEnv.id,
      environmentName: matchedEnv.name,
    });
  } catch (error) {
    console.error("Agent enrollment error:", error);
    return NextResponse.json(
      { error: "Enrollment failed" },
      { status: 500 },
    );
  }
}
