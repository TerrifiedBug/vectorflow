import { writeFile, rm, mkdtemp } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "js-yaml";

const execFileAsync = promisify(execFile);

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string; componentKey?: string }>;
  warnings: Array<{ message: string }>;
}

/**
 * Validate a Vector YAML config. Attempts to use the `vector` binary first,
 * falling back to basic structural validation if the binary is not available.
 */
export async function validateConfig(
  yamlContent: string,
): Promise<ValidationResult> {
  // Try using vector binary first
  try {
    const tmpDir = await mkdtemp(join(tmpdir(), "vectorflow-"));
    const tmpFile = join(tmpDir, "config.yaml");
    await writeFile(tmpFile, yamlContent);

    try {
      const { stderr } = await execFileAsync(
        "vector",
        ["validate", "--no-environment", tmpFile],
        { timeout: 10000 },
      );

      // Parse output for warnings
      const warnings = parseVectorWarnings(stderr || "");
      return { valid: true, errors: [], warnings };
    } catch (err: any) {
      // If vector binary is not installed, fall back to structural validation
      if (err.code === "ENOENT") {
        return basicStructuralValidation(yamlContent);
      }
      // Parse stdout+stderr for errors, try to map to component keys
      const output = [err.stdout, err.stderr, err.message]
        .filter(Boolean)
        .join("\n");
      const errors = parseVectorErrors(output);
      return { valid: false, errors, warnings: [] };
    } finally {
      await rm(tmpDir, { recursive: true }).catch(() => {});
    }
  } catch {
    // Fallback: basic structural validation
    return basicStructuralValidation(yamlContent);
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
      // Try to extract component key references from error lines
      // Vector errors often mention component keys in formats like:
      //   sources.my_source, transforms.my_transform, sinks.my_sink
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
 * Performs basic structural validation on Vector YAML config without
 * requiring the vector binary. Checks for common issues.
 */
function basicStructuralValidation(yamlContent: string): ValidationResult {
  const errors: Array<{ message: string; componentKey?: string }> = [];
  const warnings: Array<{ message: string }> = [];

  // 1. Parse YAML
  let config: Record<string, any>;
  try {
    config = yaml.load(yamlContent) as Record<string, any>;
  } catch (err: any) {
    return {
      valid: false,
      errors: [{ message: `Invalid YAML: ${err.message}` }],
      warnings: [],
    };
  }

  if (!config || typeof config !== "object") {
    return {
      valid: false,
      errors: [{ message: "Config must be a YAML object" }],
      warnings: [],
    };
  }

  const sources = config.sources || {};
  const transforms = config.transforms || {};
  const sinks = config.sinks || {};

  // 2. Check at least one source exists
  if (Object.keys(sources).length === 0) {
    errors.push({ message: "Pipeline must have at least one source" });
  }

  // 3. Check at least one sink exists
  if (Object.keys(sinks).length === 0) {
    errors.push({ message: "Pipeline must have at least one sink" });
  }

  // Build set of all valid component keys for input reference validation
  const allComponentKeys = new Set<string>([
    ...Object.keys(sources),
    ...Object.keys(transforms),
    ...Object.keys(sinks),
  ]);

  // 4. Check all sinks have inputs
  for (const [key, sinkConfig] of Object.entries(sinks)) {
    if (!sinkConfig || typeof sinkConfig !== "object") {
      errors.push({
        message: `Sink "${key}" has invalid configuration`,
        componentKey: key,
      });
      continue;
    }
    const sc = sinkConfig as Record<string, any>;
    if (!sc.inputs || !Array.isArray(sc.inputs) || sc.inputs.length === 0) {
      errors.push({
        message: `Sink "${key}" must have at least one input`,
        componentKey: key,
      });
    } else {
      // Validate each input references a valid component
      for (const input of sc.inputs) {
        if (!allComponentKeys.has(input)) {
          errors.push({
            message: `Sink "${key}" references unknown input "${input}"`,
            componentKey: key,
          });
        }
      }
    }

    // Check sink has a type
    if (!sc.type) {
      errors.push({
        message: `Sink "${key}" is missing required "type" field`,
        componentKey: key,
      });
    }
  }

  // 5. Check all transform inputs reference valid component keys
  for (const [key, transformConfig] of Object.entries(transforms)) {
    if (!transformConfig || typeof transformConfig !== "object") {
      errors.push({
        message: `Transform "${key}" has invalid configuration`,
        componentKey: key,
      });
      continue;
    }
    const tc = transformConfig as Record<string, any>;
    if (
      !tc.inputs ||
      !Array.isArray(tc.inputs) ||
      tc.inputs.length === 0
    ) {
      errors.push({
        message: `Transform "${key}" must have at least one input`,
        componentKey: key,
      });
    } else {
      for (const input of tc.inputs) {
        if (!allComponentKeys.has(input)) {
          errors.push({
            message: `Transform "${key}" references unknown input "${input}"`,
            componentKey: key,
          });
        }
      }
    }

    // Check transform has a type
    if (!tc.type) {
      errors.push({
        message: `Transform "${key}" is missing required "type" field`,
        componentKey: key,
      });
    }

    // Check component-specific required fields
    if (tc.type === "remap") {
      if (!tc.source && !tc.file && !tc.files) {
        errors.push({
          message: `Transform "${key}" (remap) requires a "source", "file", or "files" field`,
          componentKey: key,
        });
      }
    } else if (tc.type === "filter") {
      if (!tc.condition) {
        errors.push({
          message: `Transform "${key}" (filter) requires a "condition" field`,
          componentKey: key,
        });
      }
    } else if (tc.type === "route") {
      if (!tc.route || typeof tc.route !== "object" || Object.keys(tc.route).length === 0) {
        errors.push({
          message: `Transform "${key}" (route) requires at least one route condition`,
          componentKey: key,
        });
      }
    }
  }

  // 6. Check all sources have a type
  for (const [key, sourceConfig] of Object.entries(sources)) {
    if (!sourceConfig || typeof sourceConfig !== "object") {
      errors.push({
        message: `Source "${key}" has invalid configuration`,
        componentKey: key,
      });
      continue;
    }
    const sc = sourceConfig as Record<string, any>;
    if (!sc.type) {
      errors.push({
        message: `Source "${key}" is missing required "type" field`,
        componentKey: key,
      });
    }
  }

  // Warn about unused sources (sources not referenced by any transform or sink inputs)
  const referencedKeys = new Set<string>();
  for (const tc of Object.values(transforms)) {
    const inputs = (tc as any)?.inputs;
    if (Array.isArray(inputs)) {
      for (const input of inputs) referencedKeys.add(input);
    }
  }
  for (const sc of Object.values(sinks)) {
    const inputs = (sc as any)?.inputs;
    if (Array.isArray(inputs)) {
      for (const input of inputs) referencedKeys.add(input);
    }
  }
  for (const sourceKey of Object.keys(sources)) {
    if (!referencedKeys.has(sourceKey)) {
      warnings.push({
        message: `Source "${sourceKey}" is not referenced by any transform or sink`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
