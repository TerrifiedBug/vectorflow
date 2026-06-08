import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { prisma } from "@/lib/prisma";
import { saveTapCapture } from "@/server/services/active-taps";
import { evaluateVrl } from "@/server/services/transform-eval";

/**
 * Persisted live-tap captures (Plan B4). A `TapCapture` is a named snapshot of
 * real events tapped/sampled from a pipeline component, retained beyond the
 * ephemeral tap / `EventSample` TTL so the editor can iterate: re-run a VRL
 * change against the same real events and see the before/after diff + reduction.
 *
 * Every procedure carries `pipelineId` so `withTeamAccess` can resolve the
 * owning team/org (there is no team-resolution path from a bare capture id).
 * `get` / `delete` / `testTransform` additionally verify the capture belongs to
 * that pipeline AND the caller's org as defense-in-depth on top of RLS.
 */

/** Cap captured events so a single capture cannot blow past the agent body
 *  limit when replayed; matches the spirit of EventSample's bounded samples. */
const MAX_CAPTURE_EVENTS = 1000;

/**
 * Reject a capture that is missing or scoped to a different pipeline/org with a
 * uniform NOT_FOUND (no cross-tenant existence leak). Generic so the caller
 * keeps the full selected row type (e.g. `events`/`schema`) after the check.
 */
function assertCaptureScope<T extends { organizationId: string; pipelineId: string }>(
  capture: T | null,
  pipelineId: string,
  organizationId: string,
): T {
  if (
    !capture ||
    capture.pipelineId !== pipelineId ||
    capture.organizationId !== organizationId
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Capture not found" });
  }
  return capture;
}

export const tapCaptureRouter = router({
  /**
   * Persist a capture from explicitly supplied events, or — when `events` is
   * omitted — from the most recent successful `EventSample` of the component.
   */
  create: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        name: z.string().min(1).max(100),
        componentKey: z.string().min(1),
        events: z.array(z.unknown()).max(MAX_CAPTURE_EVENTS).optional(),
        schema: z.record(z.string(), z.unknown()).optional(),
        /** Narrow the EventSample source to a specific sample request. */
        fromRequestId: z.string().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("tapCapture.created", "TapCapture"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id ?? null;

      let events: unknown[];
      let schema: unknown;
      if (input.events !== undefined) {
        events = input.events;
        schema = input.schema ?? {};
      } else {
        // Source from the latest successful sample for this component.
        const sample = await prisma.eventSample.findFirst({
          where: {
            pipelineId: input.pipelineId,
            componentKey: input.componentKey,
            error: null,
            ...(input.fromRequestId ? { requestId: input.fromRequestId } : {}),
          },
          orderBy: { sampledAt: "desc" },
          select: { events: true, schema: true },
        });
        if (!sample) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No sampled events found for this component to capture",
          });
        }
        events = Array.isArray(sample.events) ? (sample.events as unknown[]) : [];
        schema = sample.schema ?? {};
      }

      if (events.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot save an empty capture",
        });
      }
      if (events.length > MAX_CAPTURE_EVENTS) {
        events = events.slice(0, MAX_CAPTURE_EVENTS);
      }

      return saveTapCapture({
        organizationId: ctx.organizationId,
        pipelineId: input.pipelineId,
        name: input.name,
        componentKey: input.componentKey,
        events,
        schema,
        createdById: userId,
      });
    }),

  /** Captures for a pipeline (summary only — no events blob). */
  list: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.tapCapture.findMany({
        where: { pipelineId: input.pipelineId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          componentKey: true,
          eventCount: true,
          createdAt: true,
        },
      });
    }),

  /** A single capture including its events + inferred schema. */
  get: protectedProcedure
    .input(z.object({ pipelineId: z.string(), captureId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      const capture = assertCaptureScope(
        await prisma.tapCapture.findUnique({
          where: { id: input.captureId },
          select: {
            id: true,
            organizationId: true,
            pipelineId: true,
            name: true,
            componentKey: true,
            eventCount: true,
            events: true,
            schema: true,
            createdAt: true,
          },
        }),
        input.pipelineId,
        ctx.organizationId,
      );
      return {
        id: capture.id,
        pipelineId: capture.pipelineId,
        name: capture.name,
        componentKey: capture.componentKey,
        eventCount: capture.eventCount,
        events: capture.events,
        schema: capture.schema,
        createdAt: capture.createdAt,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ pipelineId: z.string(), captureId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("tapCapture.deleted", "TapCapture"))
    .mutation(async ({ input, ctx }) => {
      // Single org+pipeline-scoped delete; count===0 means not found (or
      // belongs to another tenant — indistinguishable to the caller).
      const { count } = await prisma.tapCapture.deleteMany({
        where: {
          id: input.captureId,
          pipelineId: input.pipelineId,
          organizationId: ctx.organizationId,
        },
      });
      if (count === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Capture not found" });
      }
      // Return the id so withAudit records it as the entityId.
      return { id: input.captureId, deleted: true };
    }),

  /**
   * Run a VRL program against a capture's events and return the transformed
   * outputs plus reduction stats — the editor's "test this change against the
   * last N real events" before/after diff. Read-only preview (no DB writes),
   * so VIEWER and no audit.
   */
  testTransform: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        captureId: z.string(),
        source: z.string(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .mutation(async ({ input, ctx }) => {
      const capture = assertCaptureScope(
        await prisma.tapCapture.findUnique({
          where: { id: input.captureId },
          select: { organizationId: true, pipelineId: true, events: true },
        }),
        input.pipelineId,
        ctx.organizationId,
      );
      const events = Array.isArray(capture.events)
        ? (capture.events as unknown[])
        : [];
      const result = await evaluateVrl(input.source, events, { orgId: ctx.organizationId });
      return {
        outputs: result.outputs,
        stats: {
          inputCount: result.inputCount,
          outputCount: result.outputCount,
          droppedCount: result.droppedCount,
          eventReductionPercent: result.eventReductionPercent,
          byteReductionPercent: result.byteReductionPercent,
        },
        error: result.error,
      };
    }),
});
