import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runVfCli } from "../vf";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    VECTORFLOW_URL: "https://vf.example.test",
    VECTORFLOW_TOKEN: "vf_test_token",
    ...overrides,
  };
}

function vectorConfigFile() {
  const dir = mkdtempSync(join(tmpdir(), "vf-cli-"));
  const configPath = join(dir, "vector.yaml");
  writeFileSync(
    configPath,
    [
      "sources:",
      "  demo:",
      "    type: demo_logs",
      "    format: json",
      "sinks:",
      "  console:",
      "    type: console",
      "    inputs: [demo]",
      "    encoding:",
      "      codec: json",
      "",
    ].join("\n"),
  );
  return configPath;
}

describe("vf CLI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fails clearly when VECTORFLOW_URL is missing", async () => {
    const result = await runVfCli(["deploy-status", "pipe-1"], {
      env: env({ VECTORFLOW_URL: undefined }),
      fetch: vi.fn(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("VECTORFLOW_URL is required");
  });

  it("fails clearly when VECTORFLOW_TOKEN is missing", async () => {
    const result = await runVfCli(["deploy-status", "pipe-1"], {
      env: env({ VECTORFLOW_TOKEN: undefined }),
      fetch: vi.fn(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("VECTORFLOW_TOKEN is required");
  });

  it("fetches deploy status from pipeline detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ pipeline: { id: "pipe-1", name: "api", isDraft: false, deployedAt: "2026-01-01T00:00:00.000Z" } }),
    });

    const result = await runVfCli(["deploy-status", "pipe-1"], { env: env(), fetch: fetchMock as never });

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith("https://vf.example.test/api/v1/pipelines/pipe-1", {
      headers: { Authorization: "Bearer vf_test_token", Accept: "application/json" },
    });
    expect(result.stdout).toContain("deployed");
  });

  it("exports pipeline config", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ format: "yaml", config: "sources: {}\n" }),
    });

    const result = await runVfCli(["export", "pipe-1"], { env: env(), fetch: fetchMock as never });

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith("https://vf.example.test/api/v1/pipelines/pipe-1/config", {
      headers: { Authorization: "Bearer vf_test_token", Accept: "application/json" },
    });
    expect(result.stdout).toBe("sources: {}\n");
  });

  it("imports a Vector config file", async () => {
    const configPath = vectorConfigFile();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ pipeline: { id: "pipe-1", name: "edge-logs" } }),
    });

    const result = await runVfCli(["import", configPath, "--name", "edge-logs"], {
      env: env(),
      fetch: fetchMock as never,
    });

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith("https://vf.example.test/api/v1/pipelines/import", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer vf_test_token", "Content-Type": "application/json" }),
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ name: "edge-logs" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).yaml).toContain("demo_logs");
  });

  it("validates a Vector config locally without mutating the server", async () => {
    const fetchMock = vi.fn();

    const result = await runVfCli(["validate", vectorConfigFile()], {
      env: { VECTORFLOW_URL: undefined, VECTORFLOW_TOKEN: undefined },
      fetch: fetchMock as never,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("valid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("documents Terraform examples as API-backed examples, not a provider", () => {
    const readme = readFileSync("examples/terraform/README.md", "utf8");
    expect(readme).toContain("OpenTofu");
    expect(readme).toContain("REST API v1");
    expect(readme).not.toContain("required_providers {\n  vectorflow");
  });

  it("documents the platform automation workflow in README", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("### Platform automation");
    expect(readme).toContain("VECTORFLOW_URL");
    expect(readme).toContain("VECTORFLOW_TOKEN");
    expect(readme).toContain("pnpm vf deploy-status");
    expect(readme).toContain("examples/terraform");
    expect(readme).toContain("GitOps");
  });
});
