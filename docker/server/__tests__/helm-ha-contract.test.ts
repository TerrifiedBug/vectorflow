import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sourceChart = "charts/vectorflow-server";
let chart: string;
const requiredValues = [
  "--set",
  "secret.nextauthSecret=test-secret-at-least-16-chars",
  "--set",
  "secret.databaseUrl=postgresql://vectorflow:password@postgres:5432/vectorflow",
];
let tempRoot: string;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "vectorflow-chart-"));
  chart = join(tempRoot, "vectorflow-server");
  cpSync(sourceChart, chart, {
    recursive: true,
    filter: (src) => !src.endsWith("/charts") && !src.includes("/charts/"),
  });
  execFileSync("helm", ["dependency", "build", chart, "--skip-refresh"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}, 30_000);

afterAll(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function helmTemplate(args: string[] = []) {
  return execFileSync("helm", ["template", "vf", chart, ...requiredValues, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function helmTemplateError(args: string[]) {
  try {
    helmTemplate(args);
  } catch (error) {
    const err = error as { stderr?: Buffer | string; message: string };
    return String(err.stderr ?? err.message);
  }

  throw new Error("Expected helm template to fail");
}

describe("vectorflow-server Helm HA contract", () => {
  it("rejects multi-replica deployments without Redis", () => {
    const error = helmTemplateError(["--set", "replicaCount=2"]);

    expect(error).toContain("HA requires Redis");
  }, 30_000);

  it("requires shared ReadWriteMany data storage for multi-replica deployments", () => {
    const error = helmTemplateError([
      "--set",
      "replicaCount=2",
      "--set",
      "redis.enabled=true",
    ]);

    expect(error).toContain("HA requires persistence.data.accessMode=ReadWriteMany");
  });

  it("renders Redis-required readiness and disables per-replica migrations in HA", () => {
    const rendered = helmTemplate([
      "--set",
      "replicaCount=2",
      "--set",
      "redis.enabled=true",
      "--set",
      "persistence.data.accessMode=ReadWriteMany",
      "--set",
      "persistence.backups.enabled=true",
      "--set",
      "persistence.backups.accessMode=ReadWriteMany",
    ]);

    expect(rendered).toContain("name: VF_REDIS_REQUIRED");
    expect(rendered).toContain('value: "true"');
    expect(rendered).toContain("name: VF_RUN_MIGRATIONS");
    expect(rendered).toContain('value: "false"');
    expect(rendered).toContain("kind: Job");
    expect(rendered).toContain("prisma migrate deploy");
  });
});
