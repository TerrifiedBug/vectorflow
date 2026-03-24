import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

export interface PipelineStatusInput {
  pipelineId: string;
  version: number;
  status: "RUNNING" | "STARTING" | "STOPPED" | "CRASHED" | "PENDING";
  pid?: number | null;
  uptimeSeconds?: number | null;
  eventsIn?: number;
  eventsOut?: number;
  errorsTotal?: number;
  eventsDiscarded?: number;
  bytesIn?: number;
  bytesOut?: number;
  utilization?: number;
  recentLogs?: string[];
}

/**
 * Batch-upsert NodePipelineStatus rows using a single INSERT...ON CONFLICT
 * statement. Replaces per-pipeline sequential upserts to reduce N queries to 1.
 *
 * The caller MUST await this before running downstream consumers
 * (e.g. evaluateAlerts) that read from NodePipelineStatus.
 */
export async function batchUpsertPipelineStatuses(
  nodeId: string,
  pipelines: PipelineStatusInput[],
  now: Date,
): Promise<void> {
  if (pipelines.length === 0) return;

  const values = pipelines.map((ps) => Prisma.sql`(
    ${crypto.randomUUID()},
    ${nodeId},
    ${ps.pipelineId},
    ${ps.version},
    ${ps.status}::"ProcessStatus",
    ${ps.pid ?? null},
    ${ps.uptimeSeconds ?? null},
    ${ps.eventsIn ?? 0},
    ${ps.eventsOut ?? 0},
    ${ps.errorsTotal ?? 0},
    ${ps.eventsDiscarded ?? 0},
    ${ps.bytesIn ?? 0},
    ${ps.bytesOut ?? 0},
    ${ps.utilization ?? 0},
    ${ps.recentLogs ? JSON.stringify(ps.recentLogs) : null}::jsonb,
    ${now}
  )`);

  await prisma.$executeRaw`
    INSERT INTO "NodePipelineStatus"
      ("id", "nodeId", "pipelineId", "version", "status", "pid",
       "uptimeSeconds", "eventsIn", "eventsOut", "errorsTotal",
       "eventsDiscarded", "bytesIn", "bytesOut", "utilization",
       "recentLogs", "lastUpdated")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("nodeId", "pipelineId") DO UPDATE SET
      "version" = EXCLUDED."version",
      "status" = EXCLUDED."status",
      "pid" = EXCLUDED."pid",
      "uptimeSeconds" = EXCLUDED."uptimeSeconds",
      "eventsIn" = EXCLUDED."eventsIn",
      "eventsOut" = EXCLUDED."eventsOut",
      "errorsTotal" = EXCLUDED."errorsTotal",
      "eventsDiscarded" = EXCLUDED."eventsDiscarded",
      "bytesIn" = EXCLUDED."bytesIn",
      "bytesOut" = EXCLUDED."bytesOut",
      "utilization" = EXCLUDED."utilization",
      "recentLogs" = EXCLUDED."recentLogs",
      "lastUpdated" = EXCLUDED."lastUpdated"
  `;
}
