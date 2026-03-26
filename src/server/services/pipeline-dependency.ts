import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";

/**
 * Check whether adding an edge upstream→downstream would create a cycle.
 *
 * Algorithm: DFS from `upstreamId` following existing downstream edges.
 * If we can reach `downstreamId`, adding the edge would close a loop.
 */
async function wouldCreateCycle(
  upstreamId: string,
  downstreamId: string,
): Promise<boolean> {
  const visited = new Set<string>();
  const stack = [upstreamId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === downstreamId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    // Follow edges where `current` is the upstream → find its downstreams
    const edges = await prisma.pipelineDependency.findMany({
      where: { upstreamId: current },
      select: { downstreamId: true },
    });

    for (const edge of edges) {
      if (!visited.has(edge.downstreamId)) {
        stack.push(edge.downstreamId);
      }
    }
  }

  return false;
}

/**
 * Add a dependency: `downstreamId` depends on `upstreamId`.
 *
 * Validates:
 *  1. No self-reference
 *  2. Both pipelines exist and belong to the same environment
 *  3. No duplicate dependency
 *  4. No cycle would be created
 */
export async function addDependency(
  upstreamId: string,
  downstreamId: string,
  description?: string,
) {
  // 1. Self-reference guard
  if (upstreamId === downstreamId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A pipeline cannot depend on itself",
    });
  }

  // 2. Same-environment enforcement
  const [upstream, downstream] = await Promise.all([
    prisma.pipeline.findUnique({
      where: { id: upstreamId },
      select: { id: true, environmentId: true },
    }),
    prisma.pipeline.findUnique({
      where: { id: downstreamId },
      select: { id: true, environmentId: true },
    }),
  ]);

  if (!upstream || !downstream) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "One or both pipelines not found",
    });
  }

  if (upstream.environmentId !== downstream.environmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Dependencies must be within the same environment",
    });
  }

  // 3. Duplicate check
  const existing = await prisma.pipelineDependency.findUnique({
    where: { upstreamId_downstreamId: { upstreamId, downstreamId } },
  });

  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This dependency already exists",
    });
  }

  // 4. Cycle detection — would adding upstream→downstream create a loop?
  //    We check: can we reach upstreamId starting from downstreamId
  //    (following existing downstream edges)?
  //    If yes, then downstream already (transitively) feeds into upstream,
  //    so adding upstream←downstream would close a cycle.
  const cycleDetected = await wouldCreateCycle(downstreamId, upstreamId);

  if (cycleDetected) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Cannot add: would create a circular dependency",
    });
  }

  // 5. Create the dependency
  return prisma.pipelineDependency.create({
    data: { upstreamId, downstreamId, description },
    include: {
      upstream: { select: { id: true, name: true, isDraft: true, deployedAt: true } },
    },
  });
}

/**
 * Remove a dependency by its ID.
 */
export async function removeDependency(id: string) {
  const dep = await prisma.pipelineDependency.findUnique({ where: { id } });

  if (!dep) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Dependency not found",
    });
  }

  return prisma.pipelineDependency.delete({ where: { id } });
}

/**
 * Get upstream dependencies of a pipeline (pipelines it depends on).
 */
export async function getUpstreams(pipelineId: string) {
  return prisma.pipelineDependency.findMany({
    where: { downstreamId: pipelineId },
    include: {
      upstream: { select: { id: true, name: true, isDraft: true, deployedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Get downstream dependencies of a pipeline (pipelines that depend on it).
 */
export async function getDownstreams(pipelineId: string) {
  return prisma.pipelineDependency.findMany({
    where: { upstreamId: pipelineId },
    include: {
      downstream: { select: { id: true, name: true, isDraft: true, deployedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Get upstream dependencies of a pipeline where the upstream is still a draft
 * (undeployed). Used to warn when deploying a pipeline whose upstreams aren't
 * deployed yet.
 */
export async function getUndeployedUpstreams(pipelineId: string) {
  return prisma.pipelineDependency.findMany({
    where: {
      downstreamId: pipelineId,
      upstream: { isDraft: true },
    },
    include: {
      upstream: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Get downstream dependencies of a pipeline where the downstream is currently
 * deployed (not a draft). Used to warn when undeploying a pipeline that has
 * deployed dependents.
 */
export async function getDeployedDownstreams(pipelineId: string) {
  return prisma.pipelineDependency.findMany({
    where: {
      upstreamId: pipelineId,
      downstream: { isDraft: false },
    },
    include: {
      downstream: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}
