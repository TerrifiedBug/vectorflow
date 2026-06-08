import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { assertPipelineBatchAccess } from "@/server/authz";
import { LAKE_EVENT_TYPES, LAKE_MAX_RANGE_MS } from "@/server/services/lake/lake-query";
import {
  createReplayJob,
  cancelReplayJob,
  getReplayJob,
  listReplayJobs,
  ReplayError,
  type ReplayFilter,
} from "@/server/services/lake/replay";
import { evaluateReplayValidation } from "@/server/services/lake/replay-validation";

/**
 * VectorFlow Lake — replay / rehydration router (A4).
 *
 * Every procedure carries a `pipelineId` so `withTeamAccess` resolves the
 * owning team (membership + role enforced) and the cross-org walker can see the
 * gate. `pipelineId` is the pipeline whose team authorises the call:
 *   - `create` → the TARGET pipeline (events are re-injected into it, so EDITOR
 *     on the target is required); the source is validated org-side in the service.
 *   - `list`   → any pipeline; returns jobs touching it as source OR target.
 *   - `get`/`cancel` → a pipeline the job must reference (asserted in-handler so
 *     a caller can't authorise against pipeline A then act on an unrelated
 *     org-sibling job B).
 *
 * The org scope always comes from `ctx.organizationId`, never caller input.
 */

const eventTypeSchema = z.enum(LAKE_EVENT_TYPES as unknown as [string, ...string[]]);

const replayFilterSchema = z
  .object({
    eventType: eventTypeSchema.optional(),
    query: z.string().max(1000).optional(),
  })
  .optional();

/** to must be on/after from, and the window must not exceed LAKE_MAX_RANGE_MS. */
const withinMaxRange = (data: { fromTime: Date; toTime: Date }): boolean => {
  const span = data.toTime.getTime() - data.fromTime.getTime();
  return span >= 0 && span <= LAKE_MAX_RANGE_MS;
};
const rangeMessage = `Invalid time range: 'toTime' must be on/after 'fromTime' and span at most ${
  LAKE_MAX_RANGE_MS / (24 * 60 * 60 * 1000)
} days`;

/** Map a service `ReplayError` to the right client-facing TRPCError; rethrow
 *  anything else untouched. Shared by `create` and `cancel`. */
function rethrowReplayError(err: unknown): never {
  if (err instanceof ReplayError) {
    switch (err.code) {
      case "LAKE_DISABLED":
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
      case "NOT_CANCELLABLE":
        throw new TRPCError({ code: "CONFLICT", message: err.message });
      case "SOURCE_NOT_FOUND":
      case "TARGET_NOT_FOUND":
      case "NOT_FOUND":
        throw new TRPCError({ code: "NOT_FOUND", message: err.message });
    }
  }
  throw err;
}

export const replayRouter = router({
  /** Create a replay job that re-injects `sourcePipelineId`'s lake events over
   *  [fromTime, toTime] into the target pipeline (`pipelineId`). EDITOR on the
   *  target; audited. */
  create: protectedProcedure
    .input(
      z
        .object({
          /** Target pipeline — the re-injection destination (gates the call). */
          pipelineId: z.string(),
          /** Source pipeline whose lake events are read back. */
          sourcePipelineId: z.string(),
          fromTime: z.coerce.date(),
          toTime: z.coerce.date(),
          filter: replayFilterSchema,
        })
        .refine(withinMaxRange, { message: rangeMessage, path: ["toTime"] }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("replay.created", "ReplayJob"))
    .mutation(async ({ input, ctx }) => {
      // The target pipeline (input.pipelineId) is gated by withTeamAccess above.
      // The source pipeline is a separate tenant-scoped input: require VIEWER on
      // ITS team too, or a target-only editor could replay another team's lake
      // events into a pipeline they control (cross-team data exposure).
      await assertPipelineBatchAccess(
        [input.sourcePipelineId],
        ctx.session.user.id,
        "VIEWER",
        ctx.organizationId,
      );
      try {
        return await createReplayJob({
          orgId: ctx.organizationId,
          sourcePipelineId: input.sourcePipelineId,
          targetPipelineId: input.pipelineId,
          fromTime: input.fromTime,
          toTime: input.toTime,
          filter: input.filter as ReplayFilter | undefined,
          userId: ctx.session?.user?.id,
        });
      } catch (err) {
        rethrowReplayError(err);
      }
    }),

  /** List replay jobs touching a pipeline (as source or target), newest first. */
  list: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      return listReplayJobs({ orgId: ctx.organizationId, pipelineId: input.pipelineId });
    }),

  /** Fetch a single replay job. The job must reference `pipelineId`. */
  get: protectedProcedure
    .input(z.object({ pipelineId: z.string(), jobId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      const job = await getReplayJob({ orgId: ctx.organizationId, jobId: input.jobId });
      if (
        !job ||
        (job.targetPipelineId !== input.pipelineId && job.sourcePipelineId !== input.pipelineId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Replay job not found" });
      }
      return job;
    }),

  /** Score a completed replay against the TARGET pipeline's SLIs over the
   *  replay window — the promotion-gate signal (NF-6). The job's target must be
   *  `pipelineId`: the verdict is about the candidate the events were
   *  re-injected into, not the source they were read from. */
  validate: protectedProcedure
    .input(z.object({ pipelineId: z.string(), jobId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      const job = await getReplayJob({ orgId: ctx.organizationId, jobId: input.jobId });
      if (!job || job.targetPipelineId !== input.pipelineId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Replay job not found" });
      }
      return evaluateReplayValidation({
        targetPipelineId: job.targetPipelineId,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      });
    }),

  /** Cancel an in-flight replay job (EDITOR; audited). The job must reference
   *  `pipelineId`. Leaves the progress counters consistent. */
  cancel: protectedProcedure
    .input(z.object({ pipelineId: z.string(), jobId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("replay.cancelled", "ReplayJob"))
    .mutation(async ({ input, ctx }) => {
      const job = await getReplayJob({ orgId: ctx.organizationId, jobId: input.jobId });
      if (
        !job ||
        (job.targetPipelineId !== input.pipelineId && job.sourcePipelineId !== input.pipelineId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Replay job not found" });
      }
      try {
        return await cancelReplayJob({ orgId: ctx.organizationId, jobId: input.jobId });
      } catch (err) {
        rethrowReplayError(err);
      }
    }),
});
