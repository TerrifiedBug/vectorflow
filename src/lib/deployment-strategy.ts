import { z } from "zod";

const successCriteriaSchema = z.object({
  maxErrorRatePercent: z.number().min(0).max(100).optional(),
  maxLatencyMs: z.number().positive().optional().nullable(),
});

export const deploymentStrategySchema = z.object({
  type: z.enum(["direct", "canary"]),
  healthCheckWindowMinutes: z.number().int().min(5).max(60).optional(),
  autoBroaden: z.boolean().optional(),
  autoRollback: z.boolean().optional(),
  autoRollbackThreshold: z.number().positive().max(100).optional(),
  successCriteria: successCriteriaSchema.optional(),
});

export type DeploymentStrategy = z.infer<typeof deploymentStrategySchema>;
export type SuccessCriteria = z.infer<typeof successCriteriaSchema>;

/** Parse a raw JSON value from Prisma into a typed DeploymentStrategy, returning null if invalid or absent */
export function parseDeploymentStrategy(
  raw: unknown,
): DeploymentStrategy | null {
  if (raw === null || raw === undefined) return null;
  const result = deploymentStrategySchema.safeParse(raw);
  return result.success ? result.data : null;
}
