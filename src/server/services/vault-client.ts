import { readFile } from "node:fs/promises";
import { validateOutboundUrl } from "@/server/services/url-validation";

export type VaultAuthMethod = "token" | "approle" | "kubernetes";

export interface VaultBackendConfig {
  address: string;
  authMethod: VaultAuthMethod;
  mountPath: string;
  basePath?: string;
  namespace?: string;
  token?: string;
  roleId?: string;
  secretId?: string;
  role?: string;
}

interface VaultAuthResponse {
  auth?: {
    client_token?: string;
  };
  errors?: string[];
}

interface VaultKvV2Response {
  data?: {
    data?: Record<string, unknown>;
  };
  errors?: string[];
}

const DEFAULT_KUBERNETES_JWT_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";

export async function fetchVaultSecrets(
  config: VaultBackendConfig,
  secretNames: Iterable<string>,
  options: { basePath?: string } = {},
): Promise<Map<string, string>> {
  const token = await authenticateVault(config);
  const secrets = new Map<string, string>();
  const basePath = normalizePath(options.basePath ?? config.basePath ?? "");

  if (basePath) {
    const data = await readVaultSecretObject(config, basePath, token, `Vault read failed for ${basePath}`);
    for (const secretName of secretNames) {
      secrets.set(secretName, extractVaultFieldValue(basePath, secretName, data));
    }
    return secrets;
  }

  for (const secretName of secretNames) {
    const data = await readKvV2Data(
      config,
      token,
      secretName,
      `Vault read failed for ${secretName}`,
    );
    secrets.set(secretName, extractSecretValue(secretName, data));
  }

  return secrets;
}
export async function listVaultFields(
  config: VaultBackendConfig,
  basePath: string,
): Promise<string[]> {
  const normalizedBasePath = normalizePath(basePath);
  const data = await readVaultSecretObject(
    config,
    normalizedBasePath,
    undefined,
    `Vault field listing failed for ${normalizedBasePath}`,
  );
  return Object.keys(data).sort();
}
export async function readVaultSecretObject(
  config: VaultBackendConfig,
  basePath: string,
  tokenArg?: string,
  errorPrefix = `Vault field listing failed for ${normalizePath(basePath)}`,
): Promise<Record<string, unknown>> {
  const token = tokenArg ?? await authenticateVault(config);
  const normalizedBasePath = normalizePath(basePath);
  return readKvV2Data(
    config,
    token,
    normalizedBasePath,
    errorPrefix,
  );
}

export async function testVaultConnection(
  config: VaultBackendConfig,
  testSecretPath?: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (testSecretPath?.trim()) {
      const secretPath = testSecretPath.trim();
      await readVaultSecretObject(config, secretPath, undefined, `Vault read failed for ${secretPath}`);
    } else {
      await authenticateVault(config, { verifyToken: true });
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function authenticateVault(
  config: VaultBackendConfig,
  options: { verifyToken?: boolean } = {},
): Promise<string> {
  switch (config.authMethod) {
    case "token": {
      const token = requireNonEmpty(config.token, "Vault token is required");
      if (options.verifyToken) {
        const response = await vaultFetch(config, vaultUrl(config.address, "auth/token/lookup-self"), {
          method: "GET",
          token,
        });
        if (!response.ok) {
          throw new Error(`Vault token lookup failed: ${response.status} ${await vaultErrorMessage(response)}`);
        }
      }
      return token;
    }
    case "approle": {
      const roleId = requireNonEmpty(config.roleId, "Vault AppRole role_id is required");
      const secretId = requireNonEmpty(config.secretId, "Vault AppRole secret_id is required");
      return login(config, "auth/approle/login", {
        role_id: roleId,
        secret_id: secretId,
      });
    }
    case "kubernetes": {
      const role = requireNonEmpty(config.role, "Vault Kubernetes role is required");
      const jwt = (await readFile(DEFAULT_KUBERNETES_JWT_PATH, "utf8")).trim();
      return login(config, "auth/kubernetes/login", { jwt, role });
    }
    default: {
      const exhaustive: never = config.authMethod;
      throw new Error(`Unsupported Vault auth method: ${exhaustive}`);
    }
  }
}

async function login(
  config: VaultBackendConfig,
  path: string,
  body: Record<string, string>,
): Promise<string> {
  const response = await vaultFetch(config, vaultUrl(config.address, path), {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error(`Vault authentication failed: ${response.status} ${await vaultErrorMessage(response)}`);
  }

  const parsed = await response.json() as VaultAuthResponse;
  const token = parsed.auth?.client_token;
  if (!token) {
    throw new Error("Vault authentication response did not include a client token");
  }
  return token;
}

async function vaultFetch(
  config: VaultBackendConfig,
  url: string,
  options: {
    method: "GET" | "POST" | "LIST";
    token?: string;
    body?: Record<string, string>;
  },
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.token) headers["X-Vault-Token"] = options.token;
  if (config.namespace?.trim()) headers["X-Vault-Namespace"] = config.namespace.trim();
  if (options.body) headers["Content-Type"] = "application/json";

  // SSRF guard. Vault address is operator-controlled; in OSS it usually
  // points at a private network so we use the gated `validateOutboundUrl`
  // (no `force`). Deployments that set `VF_STRICT_OUTBOUND=true` will
  // reject a Vault URL accidentally pointing at a private IP /
  // cloud-metadata endpoint before any token is leaked.
  await validateOutboundUrl(url);

  return fetch(url, {
    method: options.method,
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

function kvV2DataUrl(config: VaultBackendConfig, secretPath: string): string {
  const mountPath = normalizePath(config.mountPath);
  const normalizedSecretPath = normalizePath(secretPath);
  const dataMarker = "/data/";

  if (mountPath.includes(dataMarker)) {
    const [mount, prefix] = mountPath.split(dataMarker, 2);
    return vaultUrl(config.address, joinVaultPath(mount, "data", prefix, normalizedSecretPath));
  }

  if (mountPath.endsWith("/data")) {
    return vaultUrl(config.address, joinVaultPath(mountPath.slice(0, -"/data".length), "data", normalizedSecretPath));
  }

  return vaultUrl(config.address, joinVaultPath(mountPath, "data", normalizedSecretPath));
}
async function readKvV2Data(
  config: VaultBackendConfig,
  token: string,
  secretPath: string,
  errorPrefix: string,
): Promise<Record<string, unknown>> {
  const response = await vaultFetch(config, kvV2DataUrl(config, secretPath), {
    method: "GET",
    token,
  });
  if (!response.ok) {
    throw new Error(`${errorPrefix}: ${response.status} ${await vaultErrorMessage(response)}`);
  }

  const body = await response.json() as VaultKvV2Response;
  const data = body.data?.data;
  if (!data || typeof data !== "object") {
    throw new Error(`Vault secret "${secretPath}" did not contain KV v2 data`);
  }

  return data;
}

function vaultUrl(address: string, path: string): string {
  const base = address.trim().replace(/\/+$/, "");
  const parsed = new URL(base);
  if (parsed.protocol !== "https:") {
    throw new Error("Vault address must use HTTPS");
  }
  return `${base}/v1/${encodeVaultPath(path)}`;
}

function encodeVaultPath(path: string): string {
  const segments = normalizePath(path).split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Vault paths cannot contain . or .. segments");
  }
  return segments.map(encodeURIComponent).join("/");
}

function joinVaultPath(...parts: Array<string | undefined>): string {
  return parts.map((part) => normalizePath(part ?? "")).filter(Boolean).join("/");
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

function extractSecretValue(secretName: string, data: Record<string, unknown>): string {
  if ("value" in data) {
    if (typeof data.value === "string") return data.value;
    throw new Error(`Vault secret "${secretName}" must contain a string \`value\` field`);
  }

  const stringEntries = Object.values(data).filter((value): value is string => typeof value === "string");
  if (stringEntries.length === 1) return stringEntries[0];

  throw new Error(`Vault secret "${secretName}" must contain a string \`value\` field`);
}
function extractVaultFieldValue(
  basePath: string,
  secretName: string,
  data: Record<string, unknown>,
): string {
  const value = data[secretName];
  if (typeof value === "string") return value;
  if (!(secretName in data)) {
    throw new Error(`Vault field "${secretName}" was not found in "${basePath}"`);
  }
  throw new Error(`Vault field "${secretName}" in "${basePath}" must be a string`);
}

async function vaultErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return response.statusText;

  try {
    const parsed = JSON.parse(text) as { errors?: unknown };
    if (Array.isArray(parsed.errors)) {
      return parsed.errors.map(String).join("; ");
    }
  } catch {
    // Fall through to raw text.
  }
  return text;
}

function requireNonEmpty(value: string | undefined, message: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}
