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

describe("DLP VRL integration tests", async () => {
  const hasVector = await vectorAvailable();

  describe.skipIf(!hasVector)("execute VRL templates against fixtures", () => {
    for (const template of ALL_DLP_TEMPLATES) {
      // Skip custom regex — it requires user-configured pattern
      if (template.id === "dlp-custom-regex-masking") continue;

      describe(template.name, () => {
        for (const fixture of template.testFixtures) {
          it(fixture.description, async () => {
            const result = await runVrl(template.vrlSource, fixture.input);
            expect(result).toEqual(fixture.expectedOutput);
          });
        }
      });
    }
  });
});
