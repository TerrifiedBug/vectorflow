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
  // Managed-sink credential placeholders (e.g. the VectorFlow Lake sink's
  // LAKE[...] refs) are substituted with real values only at config delivery
  // (resolveLakeSinkForDelivery), not here. `vector validate` parses fields
  // such as the ClickHouse `endpoint` as a URI, so a literal `LAKE[endpoint]`
  // panics ("invalid authority: IdnaError"). Stub them with syntactically-valid
  // stand-ins so validation checks structure; delivery injects the real values.
  const content = stubManagedSinkPlaceholders(yamlContent);
  const tmpDir = await mkdtemp(join(tmpdir(), "vectorflow-"));
  const tmpFile = join(tmpDir, "config.yaml");
  await writeFile(tmpFile, content);

  try {
    const { stderr } = await execFileAsync(
      "vector",
      ["validate", "--no-environment", tmpFile],
      { timeout: 10000 },
    );

    const warnings = parseVectorWarnings(stderr || "");
    return { valid: true, errors: [], warnings };
  } catch (err: unknown) {
    const execErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (execErr.code === "ENOENT") {
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
    const output = [execErr.stdout, execErr.stderr, execErr.message]
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

/**
 * Replace managed-sink credential placeholders (`LAKE[...]`) with
 * syntactically-valid stand-ins so `vector validate` can parse the config.
 * These refs are resolved with the real endpoint/credentials only at delivery
 * (resolveLakeSinkForDelivery); validation only checks structure, so a valid
 * URL for the endpoint and a non-empty token for the rest is sufficient.
 */
export function stubManagedSinkPlaceholders(yaml: string): string {
  return yaml
    .replace(/LAKE\[endpoint\]/g, "http://localhost:8123")
    .replace(/LAKE\[[^\]]+\]/g, "vf_lake_validate");
}
