import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  const chartYamlPath = join(chart, "Chart.yaml");
  const chartYaml = readFileSync(chartYamlPath, "utf8");
  writeFileSync(chartYamlPath, chartYaml.replace(/\ndependencies:\n(?:  .+\n)+/m, "\n"));
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
      "--set",
      "imagePullSecrets[0].name=private-registry",
    ]);

    expect(rendered).toContain("name: VF_REDIS_REQUIRED");
    expect(rendered).toContain('value: "true"');
    expect(rendered).toContain("name: VF_RUN_MIGRATIONS");
    expect(rendered).toContain('value: "false"');
    expect(rendered).toContain("kind: Job");
    expect(rendered).toContain('"helm.sh/hook": post-install,pre-upgrade');
    expect(rendered).toContain("imagePullSecrets:");
    expect(rendered).toContain("name: private-registry");
    expect(rendered).toContain("prisma migrate deploy");
  });

  it("rejects HA existingSecret values unless REDIS_URL presence is asserted", () => {
    const error = helmTemplateError([
      "--set",
      "replicaCount=2",
      "--set",
      "existingSecret=vectorflow-secrets",
      "--set",
      "persistence.data.accessMode=ReadWriteMany",
    ]);

    expect(error).toContain("existingSecretContainsRedisUrl=true");
  });

  it("disables startup migrations when migration job is enabled on single-replica", () => {
    const rendered = helmTemplate([
      "--set",
      "migrations.job.enabled=true",
    ]);

    expect(rendered).toContain("name: VF_RUN_MIGRATIONS");
    expect(rendered).toContain('value: "false"');
    expect(rendered).toContain("kind: Job");
    expect(rendered).toContain("prisma migrate deploy");
  });

  it("rejects HA when existingSecret is set and inline redisUrl would bypass validation", () => {
    const error = helmTemplateError([
      "--set",
      "replicaCount=2",
      "--set",
      "existingSecret=vectorflow-secrets",
      "--set",
      "secret.redisUrl=redis://localhost:6379",
      "--set",
      "persistence.data.accessMode=ReadWriteMany",
    ]);

    expect(error).toContain("existingSecretContainsRedisUrl=true");
  });
});
