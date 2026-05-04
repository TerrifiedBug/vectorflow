import type { Role } from "../../src/generated/prisma";
import { hash } from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
export { prisma };

export interface SeedResult {
  userId: string;
  teamId: string;
  environmentId: string;
  pipelineId: string;
  nodeId: string;
}

export async function readSeedResult(): Promise<SeedResult> {
  const fs = await import("fs/promises");
  return JSON.parse(await fs.readFile("e2e/.auth/seed-result.json", "utf-8")) as SeedResult;
}

export async function createUserWithRole(role: Role): Promise<{ email: string; password: string; userId: string }> {
  const seed = await readSeedResult();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-${role.toLowerCase()}-${stamp}@test.local`;
  const password = "TestPassword123!";

  const user = await prisma.user.create({
    data: {
      email,
      name: `E2E ${role} ${stamp}`,
      passwordHash: await hash(password, 10),
      authMethod: "LOCAL",
      totpEnabled: false,
      isSuperAdmin: false,
      mustChangePassword: false,
      memberships: {
        create: {
          teamId: seed.teamId,
          role,
        },
      },
    },
  });

  return { email, password, userId: user.id };
}

export async function createLargePipeline(nodeCount = 55): Promise<{ pipelineId: string; name: string }> {
  const seed = await readSeedResult();
  const name = `E2E Large Pipeline ${Date.now()}`;

  const pipeline = await prisma.pipeline.create({
    data: {
      name,
      description: `Auto-generated large pipeline with ${nodeCount} nodes`,
      environmentId: seed.environmentId,
      isDraft: true,
      createdById: seed.userId,
    },
  });

  const createdNodes: string[] = [];
  for (let i = 0; i < nodeCount; i += 1) {
    const kind = i === 0 ? "SOURCE" : i === nodeCount - 1 ? "SINK" : "TRANSFORM";
    const componentType = kind === "SOURCE" ? "demo_logs" : kind === "SINK" ? "blackhole" : "remap";
    const created = await prisma.pipelineNode.create({
      data: {
        pipelineId: pipeline.id,
        componentKey: `${componentType}_${i}`,
        displayName: `${componentType}-${i}`,
        componentType,
        kind,
        config: kind === "TRANSFORM" ? { source: "." } : {},
        positionX: 100 + (i % 10) * 220,
        positionY: 120 + Math.floor(i / 10) * 140,
      },
    });
    createdNodes.push(created.id);
  }

  for (let i = 0; i < createdNodes.length - 1; i += 1) {
    await prisma.pipelineEdge.create({
      data: {
        pipelineId: pipeline.id,
        sourceNodeId: createdNodes[i],
        targetNodeId: createdNodes[i + 1],
      },
    });
  }

  return { pipelineId: pipeline.id, name };
}
