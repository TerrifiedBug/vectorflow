/**
 * Shared Zod schemas used across pipeline sub-routers.
 */
import { z } from "zod";
import { ComponentKind } from "@/generated/prisma";

/** Pipeline names must be safe identifiers */
export const pipelineNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/,
    "Pipeline name must start with a letter or number and contain only letters, numbers, spaces, hyphens, and underscores",
  );

export const nodeSchema = z.object({
  id: z.string().optional(),
  componentKey: z.string().min(1).max(128).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  displayName: z.string().max(64).nullable().optional(),
  componentType: z.string().min(1),
  kind: z.nativeEnum(ComponentKind),
  config: z.record(z.string(), z.any()),
  positionX: z.number(),
  positionY: z.number(),
  disabled: z.boolean().default(false),
  sharedComponentId: z.string().nullable().optional(),
  sharedComponentVersion: z.number().nullable().optional(),
});

export const edgeSchema = z.object({
  id: z.string().optional(),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  sourcePort: z.string().optional(),
});
