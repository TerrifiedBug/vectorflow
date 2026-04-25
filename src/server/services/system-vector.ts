// Node-only imports are deferred to avoid Edge bundler errors.
// This file is dynamically imported from instrumentation.ts behind a
// `NEXT_RUNTIME === "nodejs"` guard, but the Edge bundler still traces into it
// and rejects any Node-only API that appears at module evaluation time.
import yaml from "js-yaml";
import { getAuditLogPath } from "@/server/services/audit";
import { debugLog, errorLog } from "@/lib/logger";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process") as typeof import("child_process");
type ChildProcess = import("child_process").ChildProcess;

const VECTOR_BIN = process.env.VF_VECTOR_BIN ?? "vector";

function getVectorflowDataDir(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("path") as typeof import("path");
  return join(process.cwd(), ".vectorflow");
}

function getSystemConfigPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("path") as typeof import("path");
  return (
    process.env.VF_SYSTEM_CONFIG_PATH ??
    join(getVectorflowDataDir(), "system-pipeline.yaml")
  );
}

let vectorProcess: ChildProcess | null = null;
let _shutdownHookRegistered = false;

/**
 * Start (or restart) the local Vector process for the system pipeline.
 * Writes the provided YAML config to disk and spawns a Vector child process.
 */
export async function startSystemVector(configYaml: string): Promise<void> {
  // Lazy-require Node-only deps. Only used at runtime; deferred import keeps
  // the Edge bundler from tracing into them at module evaluation.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writeFile, mkdir } = require("fs/promises") as typeof import("fs/promises");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dirname, join } = require("path") as typeof import("path");

  const systemConfigPath = getSystemConfigPath();
  const dataRoot = getVectorflowDataDir();

  // Ensure the config directory exists
  await mkdir(dirname(systemConfigPath), { recursive: true });

  // Parse the config, inject runtime paths, and re-serialize.
  // The audit log source path and data_dir are runtime values that depend on
  // the deployment environment, not user configuration.
  const dataDir = join(dataRoot, "vector-data");
  await mkdir(dataDir, { recursive: true });

  const config = yaml.load(configYaml) as Record<string, unknown>;
  config.data_dir = dataDir;

  // Override the audit_log source's include path with the actual write location
  const sources = config.sources as Record<string, Record<string, unknown>> | undefined;
  if (sources?.audit_log) {
    sources.audit_log.include = [getAuditLogPath()];
  }

  const fullConfig = yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true });

  // Write config to disk
  await writeFile(systemConfigPath, fullConfig);

  // Stop existing process if running
  await stopSystemVector();

  // Register shutdown hook on first successful start (idempotent).
  ensureShutdownHook();

  const proc = spawn(VECTOR_BIN, ["--config", systemConfigPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  vectorProcess = proc;

  proc.stdout?.on("data", (data: Buffer) => {
    debugLog("system-vector", data.toString().trimEnd());
  });

  proc.stderr?.on("data", (data: Buffer) => {
    errorLog("system-vector", data.toString().trimEnd());
  });

  proc.on("exit", (code, signal) => {
    debugLog("system-vector", `process exited with code ${code}, signal ${signal}`);
    // Only nullify if this is still the current process (not replaced by a restart)
    if (vectorProcess === proc) {
      vectorProcess = null;
    }
  });
}

/**
 * Stop the local Vector child process if it is running.
 * Waits for the process to actually exit, with a SIGKILL fallback timeout.
 */
export async function stopSystemVector(): Promise<void> {
  if (!vectorProcess) return;

  const proc = vectorProcess;
  vectorProcess = null;

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 5000);

    proc.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    proc.kill("SIGTERM");
  });
}

/**
 * Restart the local Vector process with a new config.
 * Convenience alias for startSystemVector.
 */
export async function restartSystemVector(configYaml: string): Promise<void> {
  await startSystemVector(configYaml);
}

/**
 * Check whether the local Vector child process is currently running.
 */
export function isSystemVectorRunning(): boolean {
  return vectorProcess !== null && vectorProcess.exitCode === null;
}

/**
 * Register a shutdown hook so the Vector child process is killed when the
 * Node.js server process receives SIGTERM or SIGINT. Idempotent — safe to call
 * on every `startSystemVector` invocation.
 *
 * Called from `startSystemVector` rather than at module load to keep
 * `process.on()` out of the Edge bundler's static analysis path.
 */
function ensureShutdownHook(): void {
  if (_shutdownHookRegistered) return;
  _shutdownHookRegistered = true;

  const cleanup = () => {
    if (vectorProcess) {
      vectorProcess.kill("SIGTERM");
    }
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
