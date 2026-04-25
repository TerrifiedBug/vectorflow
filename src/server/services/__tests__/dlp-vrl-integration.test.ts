// src/server/services/__tests__/dlp-vrl-integration.test.ts
import { describe, it, expect } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ALL_DLP_TEMPLATES } from "../dlp-templates";

const execFileAsync = promisify(execFile);

async function vectorAvailable(): Promise<boolean> {
  try {
    await execFileAsync("vector", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the installed Vector binary supports the VRL `repeat()` function.
 * `repeat()` was added after Vector 0.54; older binaries emit "call to undefined function".
 * TODO: Remove this guard once CI is pinned to a Vector release that includes repeat().
 */
async function vectorSupportsRepeat(): Promise<boolean> {
  const tmpDir = await mkdtemp(join(tmpdir(), "dlp-test-cap-"));
  const programPath = join(tmpDir, "program.vrl");
  const inputPath = join(tmpDir, "input.json");
  try {
    await writeFile(programPath, '. = { "r": repeat("*", 3) }');
    await writeFile(inputPath, "{}");
    await execFileAsync(
      "vector",
      ["vrl", "--input", inputPath, "--program", programPath, "--print-object"],
      { timeout: 5000, env: { ...process.env, VECTOR_LOG: "error" } }
    );
    return true;
  } catch {
    return false;
  } finally {
    await unlink(programPath).catch(() => {});
    await unlink(inputPath).catch(() => {});
  }
}

async function runVrl(
  source: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const tmpDir = await mkdtemp(join(tmpdir(), "dlp-test-"));
  const programPath = join(tmpDir, "program.vrl");
  const inputPath = join(tmpDir, "input.json");

  try {
    await writeFile(programPath, source);
    await writeFile(inputPath, JSON.stringify(input));

    const { stdout } = await execFileAsync(
      "vector",
      ["vrl", "--input", inputPath, "--program", programPath, "--print-object"],
      { timeout: 10000, env: { ...process.env, VECTOR_LOG: "error" } }
    );

    return JSON.parse(stdout.trim());
  } finally {
    await unlink(programPath).catch(() => {});
    await unlink(inputPath).catch(() => {});
  }
}

// Templates whose VRL source uses functions not available in all Vector versions.
// repeat() is not present in Vector <=0.54; skip those fixtures until CI is updated.
const REQUIRES_REPEAT = new Set(["dlp-credit-card-masking"]);

describe("DLP VRL integration tests", async () => {
  const hasVector = await vectorAvailable();
  const hasRepeat = hasVector && (await vectorSupportsRepeat());

  describe.skipIf(!hasVector)("execute VRL templates against fixtures", () => {
    for (const template of ALL_DLP_TEMPLATES) {
      // Skip custom regex — it requires user-configured pattern
      if (template.id === "dlp-custom-regex-masking") continue;

      const needsRepeat = REQUIRES_REPEAT.has(template.id);

      describe.skipIf(needsRepeat && !hasRepeat)(
        // Append a note when skipped so the reason is visible in test output
        needsRepeat && !hasRepeat
          ? `${template.name} [skipped: Vector repeat() not available]`
          : template.name,
        () => {
          for (const fixture of template.testFixtures) {
            it(fixture.description, async () => {
              const result = await runVrl(template.vrlSource, fixture.input);
              expect(result).toEqual(fixture.expectedOutput);
            });
          }
        }
      );
    }
  });
});
