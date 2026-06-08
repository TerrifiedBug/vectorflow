import { z } from "zod";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/lib/prisma";
import { evaluateVrl } from "@/server/services/transform-eval";
import { simulateTailSample as runTailSampleSimulation } from "@/server/services/trace-sampling";
import { withAudit } from "@/server/middleware/audit";
import { Prisma } from "@/generated/prisma";

const execFileAsync = promisify(execFile);

/** Cap saved VRL unit tests per component so "Run all" can't fan out unboundedly. */
const MAX_VRL_UNIT_TESTS_PER_COMPONENT = 50;
/** Max concurrent `vector` subprocesses when running unit tests (each evaluateVrl spawns one). */
const VRL_TEST_RUN_CONCURRENCY = 4;

export interface VrlDiagnostic {
  line: number;
  column: number;
  message: string;
}

export function parseVrlDiagnostics(errorText: string): VrlDiagnostic[] {
  const diagnostics: VrlDiagnostic[] = [];
  // Match patterns like ":3:5" (line:col) or "line 3" or ":3,"
  const lineColRegex = /(?:line\s+|:)(\d+)(?:[:,]\s*(?:col(?:umn)?\s+)?(\d+))?/gi;
  const lines = errorText.split("\n").filter(Boolean);
  for (const line of lines) {
    lineColRegex.lastIndex = 0;
    const match = lineColRegex.exec(line);
    if (match) {
      diagnostics.push({
        line: parseInt(match[1], 10),
        column: match[2] ? parseInt(match[2], 10) : 1,
        message: line.trim(),
      });
    }
  }
  if (diagnostics.length === 0 && errorText.trim()) {
    diagnostics.push({ line: 1, column: 1, message: errorText.trim() });
  }
  return diagnostics;
}

/** Result of running one saved VRL unit test against the editor's current source. */
export interface VrlUnitTestRunResult {
  id: string;
  name: string;
  passed: boolean;
  actual: unknown;
  expected: unknown;
}

/**
 * Deep structural equality with object keys compared order-insensitively
 * (arrays stay order-sensitive — element order is semantic for events). Backs
 * the VRL unit-test runner so a transform's output matches the saved `expected`
 * snapshot regardless of the key order `vector` happens to emit.
 */
export function deepEqualUnordered(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqualUnordered(item, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bObj, key) &&
      deepEqualUnordered(aObj[key], bObj[key]),
  );
}

/** One pre-deploy test result: a saved test plus the component it ran against. */
export interface PipelineVrlUnitTestRunResult extends VrlUnitTestRunResult {
  componentKey: string;
}

/**
 * Run a batch of saved unit tests against a single VRL `source`, capping
 * concurrent `vector` subprocesses (each evaluateVrl spawns one). Shared by
 * `runUnitTests` (one component, the editor's live source) and
 * `runPipelineUnitTests` (every component, each node's persisted source) so both
 * apply identical pass/fail semantics: a compile error, a dropped event, or a
 * mismatch all report `passed: false`.
 * `orgId` threads through to `evaluateVrl` so the per-tenant `vector`
 * subprocess bound applies across concurrent calls, not just within a batch.
 */
async function runTestsAgainstSource(
  source: string,
  tests: ReadonlyArray<{ id: string; name: string; input: unknown; expected: unknown }>,
  orgId: string,
): Promise<VrlUnitTestRunResult[]> {
  const results: VrlUnitTestRunResult[] = [];
  for (let i = 0; i < tests.length; i += VRL_TEST_RUN_CONCURRENCY) {
    const batch = tests.slice(i, i + VRL_TEST_RUN_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (test) => {
        const result = await evaluateVrl(source, [test.input], { orgId });
        const actual = result.outputs.length === 1 ? result.outputs[0] : null;
        const passed =
          !result.error &&
          result.outputs.length === 1 &&
          deepEqualUnordered(actual, test.expected);
        return {
          id: test.id,
          name: test.name,
          passed,
          actual,
          expected: test.expected,
        };
      }),
    );
    results.push(...batchResults);
  }
  return results;
}

export const vrlRouter = router({
  validate: protectedProcedure
    .input(z.object({ source: z.string() }))
    .mutation(async ({ input }) => {
      if (!input.source.trim()) {
        return { errors: [] as VrlDiagnostic[] };
      }

      let tmpDir: string;
      try {
        tmpDir = await mkdtemp(join(tmpdir(), "vectorflow-vrl-"));
      } catch {
        return { errors: [] as VrlDiagnostic[] };
      }

      const programPath = join(tmpDir, "program.vrl");
      const inputPath = join(tmpDir, "input.json");
      const defaultInput = JSON.stringify({ message: "validate", timestamp: new Date().toISOString(), host: "localhost" });

      try {
        await writeFile(programPath, input.source);
        await writeFile(inputPath, defaultInput);

        const { stderr } = await execFileAsync(
          "vector",
          ["vrl", "--input", inputPath, "--program", programPath, "--print-object"],
          { timeout: 5000, env: { ...process.env, VECTOR_LOG: "error" } },
        );

        if (stderr?.trim()) {
          return { errors: parseVrlDiagnostics(stderr.trim()) };
        }
        return { errors: [] as VrlDiagnostic[] };
      } catch (err: unknown) {
        const execErr = err as NodeJS.ErrnoException & { stderr?: string };
        if (execErr.code === "ENOENT") {
          // vector not installed — silently skip inline validation
          return { errors: [] as VrlDiagnostic[] };
        }
        const errorText = execErr.stderr?.trim() ?? "";
        if (!errorText) return { errors: [] as VrlDiagnostic[] };
        return { errors: parseVrlDiagnostics(errorText) };
      } finally {
        await unlink(programPath).catch(() => {});
        await unlink(inputPath).catch(() => {});
      }
    }),

  test: protectedProcedure
    .input(
      z.object({
        source: z.string().min(1),
        input: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const start = performance.now();

      let effectiveInput = input.input.trim() || JSON.stringify({
        message: "test event",
        timestamp: new Date().toISOString(),
        host: "localhost",
      });

      // vector vrl --input expects NDJSON (one JSON object per line).
      // If the user pastes pretty-printed JSON, compact it to a single line.
      try {
        const parsed = JSON.parse(effectiveInput);
        effectiveInput = JSON.stringify(parsed);
      } catch {
        // Not valid JSON — pass through and let vector report the error
      }

      let tmpDir: string;
      try {
        tmpDir = await mkdtemp(join(tmpdir(), "vectorflow-vrl-"));
      } catch {
        return {
          output: "",
          error: "Failed to create temporary directory",
          durationMs: 0,
        };
      }

      const programPath = join(tmpDir, "program.vrl");
      const inputPath = join(tmpDir, "input.json");

      try {
        await writeFile(programPath, input.source);
        await writeFile(inputPath, effectiveInput);

        const { stdout, stderr } = await execFileAsync(
          "vector",
          ["vrl", "--input", inputPath, "--program", programPath, "--print-object"],
          { timeout: 10000, env: { ...process.env, VECTOR_LOG: "error" } },
        );

        const durationMs = Math.round(performance.now() - start);

        if (stderr && stderr.trim().length > 0) {
          return {
            output: stdout.trim(),
            error: stderr.trim(),
            durationMs,
          };
        }

        // Try to format the output as JSON
        let formattedOutput = stdout.trim();
        try {
          const parsed = JSON.parse(formattedOutput);
          formattedOutput = JSON.stringify(parsed, null, 2);
        } catch {
          // Output is not JSON, return as-is
        }

        return {
          output: formattedOutput,
          durationMs,
        };
      } catch (err: unknown) {
        const durationMs = Math.round(performance.now() - start);
        const execErr = err as NodeJS.ErrnoException & { stderr?: string };

        // Check if vector binary is not available
        if (execErr.code === "ENOENT") {
          return {
            output: "",
            error: "VRL testing requires vector binary. Install Vector (https://vector.dev) to use this feature.",
            durationMs,
          };
        }

        // vector vrl command returned a non-zero exit code
        return {
          output: "",
          error: execErr.stderr?.trim() || execErr.message || "Unknown error running VRL",
          durationMs,
        };
      } finally {
        await unlink(programPath).catch(() => {});
        await unlink(inputPath).catch(() => {});
      }
    }),

  /**
   * Run a VRL program against a persisted tap capture's real events — the
   * multi-event generalisation of `vrl.test` (which runs against a single
   * pasted JSON input). Loads the capture org-scoped (`withTeamAccess` resolves
   * the team via `pipelineId`) and returns the full `evaluateVrl` result
   * (outputs + reduction stats) so the editor can show a before/after diff.
   */
  testAgainstCapture: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        captureId: z.string(),
        source: z.string().min(1),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .mutation(async ({ input, ctx }) => {
      const capture = await prisma.tapCapture.findUnique({
        where: { id: input.captureId },
        select: { pipelineId: true, organizationId: true, events: true },
      });
      if (
        !capture ||
        capture.pipelineId !== input.pipelineId ||
        capture.organizationId !== ctx.organizationId
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Capture not found" });
      }
      const events = Array.isArray(capture.events)
        ? (capture.events as unknown[])
        : [];
      return evaluateVrl(input.source, events, { orgId: ctx.organizationId });
    }),

  /**
   * Preview trace tail-sampling on real sampled traces before deploying (A6).
   * Groups sample spans by trace key and runs the same keep decision the
   * deployed `tail_sample` transform compiles to (see
   * `@/server/services/trace-sampling`), returning kept/dropped traces + spans,
   * the keep ratio, and the projected reduction. Read-only preview (VIEWER, no
   * audit). Events come from a pasted set or a saved tap capture; `pipelineId`
   * lets `withTeamAccess` resolve the owning team/org. Tail-sampling is opt-in —
   * this never deploys or drops anything.
   */
  simulateTailSample: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        policy: z.object({
          key: z.string().min(1),
          windowMs: z.number().int().positive(),
          keepPolicies: z.object({
            onError: z.boolean(),
            slowThresholdMs: z.number().positive().nullable(),
            baselinePercent: z.number().min(0).max(100),
          }),
        }),
        events: z.array(z.unknown()).max(50_000).optional(),
        captureId: z.string().optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .mutation(async ({ input, ctx }) => {
      let events: unknown[] = input.events ?? [];
      if (input.captureId) {
        const capture = await prisma.tapCapture.findUnique({
          where: { id: input.captureId },
          select: { pipelineId: true, organizationId: true, events: true },
        });
        if (
          !capture ||
          capture.pipelineId !== input.pipelineId ||
          capture.organizationId !== ctx.organizationId
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Capture not found" });
        }
        events = Array.isArray(capture.events) ? (capture.events as unknown[]) : [];
      }
      return runTailSampleSimulation(events, input.policy);
    }),

  /**
   * IF-6 — saved VRL unit tests. A unit test pins a single `input` event to the
   * `expected` transformed output for a pipeline transform component, so authors
   * can capture regression cases before deploying a remap/transform. CRUD +
   * runner carry `pipelineId` (or a row `id`) so `withTeamAccess` resolves the
   * owning team/org; every query is additionally org-scoped on top of RLS.
   */
  createUnitTest: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        componentKey: z.string().min(1),
        name: z.string().min(1).max(100),
        input: z.record(z.string(), z.unknown()),
        expected: z.record(z.string(), z.unknown()),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("vrlUnitTest.created", "VrlUnitTest"))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.vrlUnitTest.count({
        where: {
          organizationId: ctx.organizationId,
          pipelineId: input.pipelineId,
          componentKey: input.componentKey,
        },
      });
      if (existing >= MAX_VRL_UNIT_TESTS_PER_COMPONENT) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A component can have at most ${MAX_VRL_UNIT_TESTS_PER_COMPONENT} unit tests.`,
        });
      }
      return prisma.vrlUnitTest.create({
        data: {
          organizationId: ctx.organizationId,
          pipelineId: input.pipelineId,
          componentKey: input.componentKey,
          name: input.name,
          input: input.input as Prisma.InputJsonValue,
          expected: input.expected as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          name: true,
          componentKey: true,
          input: true,
          expected: true,
          createdAt: true,
        },
      });
    }),

  /** Saved unit tests for a pipeline, optionally narrowed to one component. */
  listUnitTests: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        componentKey: z.string().optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      return prisma.vrlUnitTest.findMany({
        where: {
          organizationId: ctx.organizationId,
          pipelineId: input.pipelineId,
          ...(input.componentKey ? { componentKey: input.componentKey } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          componentKey: true,
          input: true,
          expected: true,
          createdAt: true,
        },
      });
    }),

  deleteUnitTest: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("vrlUnitTest.deleted", "VrlUnitTest"))
    .mutation(async ({ input, ctx }) => {
      // Org-scoped delete (defense-in-depth on top of RLS + withTeamAccess);
      // count===0 means not found, or another tenant's row — indistinguishable.
      const { count } = await prisma.vrlUnitTest.deleteMany({
        where: { id: input.id, organizationId: ctx.organizationId },
      });
      if (count === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Unit test not found" });
      }
      // Return the id so withAudit records it as the entityId.
      return { id: input.id, deleted: true };
    }),

  /**
   * Run every saved unit test for a component against the editor's current VRL
   * `source`: evaluate `source` over each test's single `input` event and assert
   * the single transformed output deep-equals (order-insensitive on object keys)
   * the saved `expected`. Read-only (VIEWER, no audit). A compile error, a
   * dropped event, or a mismatch all report `passed: false`.
   */
  runUnitTests: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        componentKey: z.string().min(1),
        source: z.string(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .mutation(async ({ input, ctx }): Promise<VrlUnitTestRunResult[]> => {
      const tests = await prisma.vrlUnitTest.findMany({
        where: {
          organizationId: ctx.organizationId,
          pipelineId: input.pipelineId,
          componentKey: input.componentKey,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, input: true, expected: true },
        take: MAX_VRL_UNIT_TESTS_PER_COMPONENT,
      });

      return runTestsAgainstSource(input.source, tests, ctx.organizationId);
    }),

  /**
   * UX-2 — pre-deploy test gate. Run every saved unit test for a pipeline
   * against its component's CURRENT persisted source (the `source` on each
   * transform PipelineNode), grouped by component, so the deploy dialog can
   * surface pass/fail before publishing. Read-only (VIEWER, no audit). Tests
   * whose component no longer carries a VRL source are skipped; the per-component
   * cap mirrors `runUnitTests`. Returns the flat results plus a roll-up summary.
   */
  runPipelineUnitTests: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .mutation(
      async ({
        input,
        ctx,
      }): Promise<{
        results: PipelineVrlUnitTestRunResult[];
        summary: { total: number; passed: number; failed: number };
      }> => {
        // PipelineNode carries no organizationId column, so org-scope through
        // its pipeline (withTeamAccess already gated team membership).
        const pipeline = await prisma.pipeline.findFirst({
          where: { id: input.pipelineId, organizationId: ctx.organizationId },
          select: {
            nodes: {
              where: { kind: "TRANSFORM" },
              select: { componentKey: true, config: true },
            },
          },
        });
        if (!pipeline) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
        }

        // componentKey -> current VRL source, for transform nodes that carry one.
        const sourceByComponent = new Map<string, string>();
        for (const node of pipeline.nodes) {
          const source = (node.config as Record<string, unknown> | null)?.source;
          if (typeof source === "string" && source.trim()) {
            sourceByComponent.set(node.componentKey, source);
          }
        }

        const tests = await prisma.vrlUnitTest.findMany({
          where: {
            organizationId: ctx.organizationId,
            pipelineId: input.pipelineId,
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, componentKey: true, input: true, expected: true },
        });

        // Group by component, dropping tests with no current source to run
        // against and capping each component (mirrors runUnitTests' take()).
        const testsByComponent = new Map<string, typeof tests>();
        for (const test of tests) {
          if (!sourceByComponent.has(test.componentKey)) continue;
          const bucket = testsByComponent.get(test.componentKey) ?? [];
          if (bucket.length >= MAX_VRL_UNIT_TESTS_PER_COMPONENT) continue;
          bucket.push(test);
          testsByComponent.set(test.componentKey, bucket);
        }

        // Components run sequentially; each component's batch is itself bounded,
        // so total concurrent `vector` processes stay within the cap.
        const results: PipelineVrlUnitTestRunResult[] = [];
        for (const [componentKey, componentTests] of testsByComponent) {
          const source = sourceByComponent.get(componentKey)!;
          const componentResults = await runTestsAgainstSource(source, componentTests, ctx.organizationId);
          for (const r of componentResults) {
            results.push({ ...r, componentKey });
          }
        }

        const passed = results.filter((r) => r.passed).length;
        return {
          results,
          summary: { total: results.length, passed, failed: results.length - passed },
        };
      },
    ),
});
