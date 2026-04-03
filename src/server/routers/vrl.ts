import { z } from "zod";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import { router, protectedProcedure } from "@/trpc/init";

const execFileAsync = promisify(execFile);

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
});
