import { writeFile, rm, mkdtemp } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";

const execFileAsync = promisify(execFile);

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string; componentKey?: string }>;
  warnings: Array<{ message: string }>;
}

/**
 * Validate a Vector YAML config using the `vector validate` CLI.
 * The Vector binary must be available (it is embedded in the server Docker image).
 */
export async function validateConfig(
  yamlContent: string,
): Promise<ValidationResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), "vectorflow-"));
  const tmpFile = join(tmpDir, "config.yaml");
  await writeFile(tmpFile, yamlContent);

  try {
    const { stderr } = await execFileAsync(
      "vector",
      ["validate", "--no-environment", tmpFile],
      { timeout: 10000 },
    );

    const warnings = parseVectorWarnings(stderr || "");
    return { valid: true, errors: [], warnings };
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return {
        valid: false,
        errors: [
          {
            message:
              "Vector binary not found. Install Vector or use the VectorFlow Docker image.",
          },
        ],
        warnings: [],
      };
    }
    const output = [err.stdout, err.stderr, err.message]
      .filter(Boolean)
      .join("\n");
    const errors = parseVectorErrors(output);
    return { valid: false, errors, warnings: [] };
  } finally {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  }
}

function parseVectorErrors(
  stderr: string,
): Array<{ message: string; componentKey?: string }> {
  return stderr
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const trimmed = line.trim();
      const keyMatch = trimmed.match(
        /(?:sources|transforms|sinks)\.(\w+)/,
      );
      return {
        message: trimmed,
        componentKey: keyMatch?.[1],
      };
    });
}

function parseVectorWarnings(
  stderr: string,
): Array<{ message: string }> {
  return stderr
    .split("\n")
    .filter(
      (line) =>
        line.trim().length > 0 &&
        (line.toLowerCase().includes("warn") ||
          line.toLowerCase().includes("deprecated")),
    )
    .map((line) => ({ message: line.trim() }));
}
