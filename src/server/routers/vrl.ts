import { z } from "zod";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import { router, protectedProcedure } from "@/trpc/init";

const execFileAsync = promisify(execFile);

export const vrlRouter = router({
  test: protectedProcedure
    .input(
      z.object({
        source: z.string().min(1),
        input: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const start = performance.now();

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
        await writeFile(inputPath, input.input);

        const { stdout, stderr } = await execFileAsync(
          "vector",
          ["vrl", "--input", inputPath, "--program", programPath],
          { timeout: 10000 },
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
      } catch (err: any) {
        const durationMs = Math.round(performance.now() - start);

        // Check if vector binary is not available
        if (err.code === "ENOENT") {
          return {
            output: "",
            error: "VRL testing requires vector binary. Install Vector (https://vector.dev) to use this feature.",
            durationMs,
          };
        }

        // vector vrl command returned a non-zero exit code
        return {
          output: "",
          error: err.stderr?.trim() || err.message || "Unknown error running VRL",
          durationMs,
        };
      } finally {
        await unlink(programPath).catch(() => {});
        await unlink(inputPath).catch(() => {});
      }
    }),
});
