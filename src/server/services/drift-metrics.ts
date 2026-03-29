// src/server/services/drift-metrics.ts
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriftedPipeline {
  pipelineId: string;
  pipelineName: string;
  expectedVersion: number;
  /** Map of nodeId -> running version */
  nodeVersions: Record<string, number>;
}

export interface VersionDriftResult {
  /** Number of pipelines with version drift */
  value: number;
  /** Details for alert message building */
  driftedPipelines: DriftedPipeline[];
}

export interface ConfigDriftResult {
  /** Number of pipelines with config checksum mismatch on this node */
  value: number;
}

// ---------------------------------------------------------------------------
// Version Drift -- fleet-wide, evaluated by FleetAlertService
// ---------------------------------------------------------------------------

/**
 * Compute version drift across all deployed pipelines in an environment.
 *
 * A pipeline has version drift if any node is running a version different
 * from the latest deployed version.
 *
 * Returns the count of drifted pipelines, or null if no data.
 */
export async function getVersionDrift(
  environmentId: string,
): Promise<VersionDriftResult | null> {
  // Get all pipeline statuses for nodes in this environment
  const statuses = await prisma.nodePipelineStatus.findMany({
    where: {
      node: { environmentId },
    },
    select: {
      pipelineId: true,
      nodeId: true,
      version: true,
    },
  });

  if (statuses.length === 0) return null;

  // Get latest deployed version for each pipeline in this environment
  const pipelineIds = [...new Set(statuses.map((s) => s.pipelineId))];

  const pipelines = await prisma.pipeline.findMany({
    where: {
      id: { in: pipelineIds },
      environmentId,
    },
    select: {
      id: true,
      name: true,
      versions: {
        orderBy: { version: "desc" as const },
        take: 1,
        select: { version: true },
      },
    },
  });

  // Build a map of pipelineId -> { name, latestVersion }
  const pipelineMap = new Map<string, { name: string; latestVersion: number }>();
  for (const p of pipelines) {
    const latestVersion = p.versions[0]?.version ?? 1;
    pipelineMap.set(p.id, { name: p.name, latestVersion });
  }

  // Group statuses by pipeline
  const statusesByPipeline = new Map<string, Array<{ nodeId: string; version: number }>>();
  for (const s of statuses) {
    const existing = statusesByPipeline.get(s.pipelineId) ?? [];
    existing.push({ nodeId: s.nodeId, version: s.version });
    statusesByPipeline.set(s.pipelineId, existing);
  }

  // Check each pipeline for drift
  const driftedPipelines: DriftedPipeline[] = [];

  for (const [pipelineId, nodeStatuses] of statusesByPipeline.entries()) {
    const pipelineInfo = pipelineMap.get(pipelineId);
    if (!pipelineInfo) continue;

    const { name, latestVersion } = pipelineInfo;

    // Check if any node runs a version different from the latest
    const hasDrift = nodeStatuses.some((ns) => ns.version !== latestVersion);

    if (hasDrift) {
      const nodeVersions: Record<string, number> = {};
      for (const ns of nodeStatuses) {
        nodeVersions[ns.nodeId] = ns.version;
      }
      driftedPipelines.push({
        pipelineId,
        pipelineName: name,
        expectedVersion: latestVersion,
        nodeVersions,
      });
    }
  }

  return {
    value: driftedPipelines.length,
    driftedPipelines,
  };
}

// ---------------------------------------------------------------------------
// Config Drift -- per-node, evaluated during heartbeat processing
// ---------------------------------------------------------------------------

/**
 * Compute config drift for a specific node.
 *
 * Compares the agent-reported configChecksum against the server-side expected
 * checksum. Pipelines where the agent does not report a checksum (older agents)
 * are ignored -- they do not count as drift.
 *
 * Returns the count of mismatched pipelines, or null if no data.
 */
export async function getConfigDrift(
  nodeId: string,
  pipelineId: string | null,
): Promise<ConfigDriftResult | null> {
  // Get pipeline statuses for this node (with checksum)
  const where: Record<string, unknown> = { nodeId };
  if (pipelineId) where.pipelineId = pipelineId;

  const statuses = await prisma.nodePipelineStatus.findMany({
    where,
    select: {
      pipelineId: true,
      configChecksum: true,
      pipeline: { select: { id: true, name: true } },
    },
  });

  if (statuses.length === 0) return null;

  // Filter to only pipelines where the agent reports a checksum
  const statusesWithChecksum = statuses.filter((s) => s.configChecksum != null);

  if (statusesWithChecksum.length === 0) {
    // All pipelines lack checksums (older agent) -- no drift detectable
    return { value: 0 };
  }

  // Get expected checksums from the in-memory cache
  const pipelineIds = statusesWithChecksum.map((s) => s.pipelineId);
  const expectedChecksums = getExpectedChecksums(pipelineIds);

  let driftCount = 0;
  for (const status of statusesWithChecksum) {
    const expected = expectedChecksums.get(status.pipelineId);
    if (expected && status.configChecksum !== expected) {
      driftCount++;
    }
    // If no expected checksum is cached yet, skip -- don't flag as drift
  }

  return { value: driftCount };
}

// ---------------------------------------------------------------------------
// Expected Config Checksum Cache
// ---------------------------------------------------------------------------

/**
 * In-memory cache of the expected config checksum per pipeline.
 * Populated by the config endpoint when it serves configs to agents.
 * Keyed by pipelineId -> SHA256 hex string.
 */
const expectedChecksumCache = new Map<string, string>();

/** Store the expected checksum for a pipeline (called from config endpoint). */
export function setExpectedChecksum(pipelineId: string, checksum: string): void {
  expectedChecksumCache.set(pipelineId, checksum);
}

/** Read expected checksums for a set of pipeline IDs. */
export function getExpectedChecksums(
  pipelineIds: string[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const id of pipelineIds) {
    const checksum = expectedChecksumCache.get(id);
    if (checksum) {
      result.set(id, checksum);
    }
  }
  return result;
}

/** Clear the cache (for testing). */
export function clearExpectedChecksumCache(): void {
  expectedChecksumCache.clear();
}
