import { readFile } from "node:fs/promises";
import { importVectorConfig } from "../lib/config-generator";

type CliEnv = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CliDeps = {
  env?: CliEnv;
  fetch?: FetchLike;
};

type CliConfig = {
  baseUrl: string;
  token: string;
};

function requireConfig(env: CliEnv): CliConfig | { error: string } {
  const baseUrl = env.VECTORFLOW_URL?.replace(/\/+$/, "");
  const token = env.VECTORFLOW_TOKEN;

  if (!baseUrl) return { error: "VECTORFLOW_URL is required" };
  if (!token) return { error: "VECTORFLOW_TOKEN is required" };
  return { baseUrl, token };
}

function usage(command?: string) {
  if (command === "deploy-status") return "Usage: vf deploy-status <pipeline-id>\n";
  if (command === "export") return "Usage: vf export <pipeline-id>\n";
  if (command === "import") return "Usage: vf import <config-path> --name <pipeline-name> [--description <text>] [--group <group-id>]\n";
  if (command === "validate") return "Usage: vf validate <config-path>\n";

  return [
    "Usage: vf <command> [args]",
    "",
    "Commands:",
    "  validate <config-path>",
    "  import <config-path> --name <pipeline-name> [--description <text>] [--group <group-id>]",
    "  export <pipeline-id>",
    "  deploy-status <pipeline-id>",
    "",
    "Environment:",
    "  VECTORFLOW_URL=https://vectorflow.example.com",
    "  VECTORFLOW_TOKEN=vf_...",
    "",
  ].join("\n");
}

function argValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function requestJson(path: string, config: CliConfig, fetchImpl: FetchLike, init: RequestInit = {}) {
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
      ...init.headers,
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function json(data: unknown) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

async function readConfig(path: string) {
  if (!path) throw new Error("config path is required");
  return readFile(path, "utf8");
}

export async function runVfCli(args: string[], deps: CliDeps = {}): Promise<CliResult> {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { exitCode: 0, stdout: usage(), stderr: "" };
  }

  const config = requireConfig(deps.env ?? process.env);
  if ("error" in config) {
    return { exitCode: 2, stdout: "", stderr: `${config.error}\n` };
  }

  const fetchImpl = deps.fetch ?? fetch;

  try {
    if (command === "deploy-status") {
      const pipelineId = args[1];
      if (!pipelineId) return { exitCode: 2, stdout: "", stderr: usage(command) };

      const data = await requestJson(`/api/v1/pipelines/${encodeURIComponent(pipelineId)}`, config, fetchImpl);
      const pipeline = (data as { pipeline?: { isDraft?: boolean; deployedAt?: string | null } }).pipeline;
      const status = pipeline?.isDraft ? "draft" : pipeline?.deployedAt ? "deployed" : "not deployed";
      return { exitCode: 0, stdout: json({ status, pipeline }), stderr: "" };
    }

    if (command === "export") {
      const pipelineId = args[1];
      if (!pipelineId) return { exitCode: 2, stdout: "", stderr: usage(command) };

      const data = await requestJson(`/api/v1/pipelines/${encodeURIComponent(pipelineId)}/config`, config, fetchImpl);
      const configText = typeof (data as { config?: unknown }).config === "string"
        ? (data as { config: string }).config
        : JSON.stringify(data, null, 2);
      return { exitCode: 0, stdout: configText.endsWith("\n") ? configText : `${configText}\n`, stderr: "" };
    }

    if (command === "import") {
      const path = args[1];
      const name = argValue(args, "--name");
      const description = argValue(args, "--description");
      const groupId = argValue(args, "--group");
      if (!path || !name) return { exitCode: 2, stdout: "", stderr: usage(command) };

      const yaml = await readConfig(path);
      const data = await requestJson("/api/v1/pipelines/import", config, fetchImpl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, yaml, description, groupId }),
      });
      return { exitCode: 0, stdout: json(data), stderr: "" };
    }

    if (command === "validate") {
      const path = args[1];
      if (!path) return { exitCode: 2, stdout: "", stderr: usage(command) };

      const content = await readConfig(path);
      const result = importVectorConfig(content);
      return {
        exitCode: 0,
        stdout: json({ valid: true, nodeCount: result.nodes.length, edgeCount: result.edges.length, warnings: result.warnings }),
        stderr: "",
      };
    }

    return { exitCode: 2, stdout: "", stderr: `Unknown command: ${command}\n${usage()}` };
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runVfCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  });
}
