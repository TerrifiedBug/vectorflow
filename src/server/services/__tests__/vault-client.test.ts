import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(() => Promise.resolve("service-account-jwt-from-disk")),
}));
import { readFile } from "node:fs/promises";

import {
  fetchVaultSecrets,
  testVaultConnection,
  type VaultBackendConfig,
  listVaultFields,
} from "../vault-client";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(readFile).mockClear();
});

  it("rejects non-HTTPS Vault addresses before sending credentials", async () => {
    await expect(fetchVaultSecrets({
      address: "http://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "vault-token",
    }, ["db"])).rejects.toThrow("Vault address must use HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects dot segments in Vault mount and secret paths", async () => {
    await expect(fetchVaultSecrets({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "vault-token",
    }, ["../../sys/mounts"])).rejects.toThrow("Vault paths cannot contain . or .. segments");

    await expect(fetchVaultSecrets({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret/../sys",
      token: "vault-token",
    }, ["db"])).rejects.toThrow("Vault paths cannot contain . or .. segments");
    expect(fetchMock).not.toHaveBeenCalled();
  });

describe("vault-client", () => {
  it("reads KV v2 secrets with a configured token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: { data: { value: "db-pass" }, metadata: { version: 3 } },
    }));

    const secrets = await fetchVaultSecrets({
      address: "https://vault.example.com/",
      authMethod: "token",
      mountPath: "/secret/",
      token: "vault-token",
      namespace: "admin/team-a",
    }, ["db/password"]);

    expect(secrets).toEqual(new Map([["db/password", "db-pass"]]));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://vault.example.com/v1/secret/data/db/password",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-Vault-Token": "vault-token",
          "X-Vault-Namespace": "admin/team-a",
        }),
      }),
    );
  });
  it("lists Vault field names from a configured base path", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: {
        data: {
          OPENSEARCH_PROD: "secret-value",
          GRAFANA_TOKEN: "another-secret",
        },
      },
    }));

    const fields = await listVaultFields({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "vault-token",
    }, "vectorflow");

    expect(fields).toEqual(["GRAFANA_TOKEN", "OPENSEARCH_PROD"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://vault.example.com/v1/secret/data/vectorflow",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "X-Vault-Token": "vault-token" }),
      }),
    );
  });

  it("returns an empty list when the base path has no fields", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { data: {} } }));

    await expect(listVaultFields({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "vault-token",
    }, "vectorflow")).resolves.toEqual([]);
  });

  it("surfaces Vault API errors when listing fields", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: ["permission denied"] }, 403));

    await expect(listVaultFields({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "vault-token",
    }, "vectorflow")).rejects.toThrow("Vault field listing failed for vectorflow: 403 permission denied");
  });

  it("surfaces missing Vault paths when listing fields", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: ["missing path"] }, 404));

    await expect(listVaultFields({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "vault-token",
    }, "vectorflow")).rejects.toThrow("Vault field listing failed for vectorflow: 404 missing path");
  });

  it("reads multiple Vault secret fields from one base path", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: {
        data: {
          OPENSEARCH_PROD: "opensearch-secret",
          GRAFANA_TOKEN: "grafana-secret",
        },
      },
    }));

    const secrets = await fetchVaultSecrets({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "vault-token",
    }, ["OPENSEARCH_PROD", "GRAFANA_TOKEN"], { basePath: "vectorflow" });

    expect(secrets).toEqual(
      new Map([
        ["OPENSEARCH_PROD", "opensearch-secret"],
        ["GRAFANA_TOKEN", "grafana-secret"],
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://vault.example.com/v1/secret/data/vectorflow",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "X-Vault-Token": "vault-token" }),
      }),
    );
  });

  it("authenticates with AppRole before reading secrets", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ auth: { client_token: "client-token" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { data: { value: "api-key" } } }));

    const secrets = await fetchVaultSecrets({
      address: "https://vault.example.com",
      authMethod: "approle",
      mountPath: "secret",
      role: "vectorflow-agent",
      roleId: "role-id",
      secretId: "secret-id",
    }, ["api-key"]);

    expect(secrets.get("api-key")).toBe("api-key");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://vault.example.com/v1/auth/approle/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ role_id: "role-id", secret_id: "secret-id" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://vault.example.com/v1/secret/data/api-key",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Vault-Token": "client-token" }),
      }),
    );
  });

  it("authenticates with the fixed server Kubernetes service account JWT before reading secrets", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ auth: { client_token: "k8s-token" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { data: { value: "sink-token" } } }));

    const secrets = await fetchVaultSecrets({
      address: "https://vault.example.com",
      authMethod: "kubernetes",
      mountPath: "secret",
      role: "vectorflow-agent",

    }, ["sink-token"]);

    expect(readFile).toHaveBeenCalledWith(
      "/var/run/secrets/kubernetes.io/serviceaccount/token",
      "utf8",
    );
    expect(secrets.get("sink-token")).toBe("sink-token");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://vault.example.com/v1/auth/kubernetes/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ jwt: "service-account-jwt-from-disk", role: "vectorflow-agent" }),
      }),
    );
  });

  it("does not read caller-supplied Kubernetes jwtPath values", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ auth: { client_token: "k8s-token" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { data: { value: "sink-token" } } }));

    await fetchVaultSecrets({
      address: "https://vault.example.com",
      authMethod: "kubernetes",
      mountPath: "secret",
      role: "vectorflow-agent",
      jwtPath: "/tmp/attacker-controlled-path",
    } as unknown as VaultBackendConfig, ["sink-token"]);

    expect(readFile).toHaveBeenCalledWith(
      "/var/run/secrets/kubernetes.io/serviceaccount/token",
      "utf8",
    );
  });

  it("uses the only scalar field when a Vault secret has no value field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { data: { password: "only-secret" } } }));

    const secrets = await fetchVaultSecrets({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "vault-token",
    }, ["db"]);

    expect(secrets.get("db")).toBe("only-secret");
  });

  it("throws when a Vault secret has ambiguous fields", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { data: { username: "u", password: "p" } } }));

    await expect(fetchVaultSecrets({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "vault-token",
    }, ["db"])).rejects.toThrow('Vault secret "db" must contain a string `value` field');
  });

  it("surfaces Vault API errors without leaking tokens", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: ["permission denied"] }, 403));

    await expect(fetchVaultSecrets({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "super-secret-token",
    }, ["db"])).rejects.toThrow("Vault read failed for db: 403 permission denied");
  });

  it("tests connectivity by authenticating and reading an optional path", async () => {
    const config: VaultBackendConfig = {
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "vault-token",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { data: { value: "ok" } } }));

    await expect(testVaultConnection(config, "healthcheck")).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://vault.example.com/v1/secret/data/healthcheck",
      expect.any(Object),
    );
  });
  it("tests connectivity against an explicit Vault path even when basePath is configured", async () => {
    const config: VaultBackendConfig = {
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      basePath: "vectorflow",
      token: "vault-token",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { data: { value: "ok" } } }));

    await expect(testVaultConnection(config, "health/check")).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://vault.example.com/v1/secret/data/health/check",
      expect.any(Object),
    );
  });
});
