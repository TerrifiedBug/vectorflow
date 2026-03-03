import { spawn, type ChildProcess } from "child_process";
import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import yaml from "js-yaml";
import { AUDIT_LOG_PATH } from "@/server/services/audit";

const VECTOR_BIN = process.env.VF_VECTOR_BIN ?? "vector";
const VECTORFLOW_DATA_DIR = join(process.cwd(), ".vectorflow");
const SYSTEM_CONFIG_PATH =
  process.env.VF_SYSTEM_CONFIG_PATH ??
  join(VECTORFLOW_DATA_DIR, "system-pipeline.yaml");

let vectorProcess: ChildProcess | null = null;

/**
 * Start (or restart) the local Vector process for the system pipeline.
 * Writes the provided YAML config to disk and spawns a Vector child process.
 */
export async function startSystemVector(configYaml: string): Promise<void> {
  // Ensure the config directory exists
  await mkdir(dirname(SYSTEM_CONFIG_PATH), { recursive: true });

  // Parse the config, inject runtime paths, and re-serialize.
  // The audit log source path and data_dir are runtime values that depend on
  // the deployment environment, not user configuration.
  const dataDir = join(VECTORFLOW_DATA_DIR, "vector-data");
  await mkdir(dataDir, { recursive: true });

  const config = yaml.load(configYaml) as Record<string, any>;
  config.data_dir = dataDir;

  // Override the audit_log source's include path with the actual write location
  if (config.sources?.audit_log) {
    config.sources.audit_log.include = [AUDIT_LOG_PATH];
  }

  const fullConfig = yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true });

  // Write config to disk
  await writeFile(SYSTEM_CONFIG_PATH, fullConfig);

  // Stop existing process if running
  await stopSystemVector();

  const proc = spawn(VECTOR_BIN, ["--config", SYSTEM_CONFIG_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  vectorProcess = proc;

  proc.stdout?.on("data", (data: Buffer) => {
    console.log(`[system-vector stdout] ${data.toString().trimEnd()}`);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    console.error(`[system-vector stderr] ${data.toString().trimEnd()}`);
  });

  proc.on("exit", (code, signal) => {
    console.log(
      `System Vector process exited with code ${code}, signal ${signal}`,
    );
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
 * Set up a shutdown hook so the Vector child process is killed
 * when the Node.js server process receives SIGTERM or SIGINT.
 */
function setupShutdownHook() {
  const cleanup = () => {
    if (vectorProcess) {
      vectorProcess.kill("SIGTERM");
    }
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

// Register shutdown hook at module load time
setupShutdownHook();
