import { LocalDevKmsProvider } from "./local-dev";
import { VaultTransitKmsProvider } from "./vault-transit";
import { DekCache } from "./dek-cache";
import type { KmsProvider } from "./types";

export type { KmsProvider, KmsKeyDescriptor, KmsProviderKind } from "./types";
export { LocalDevKmsProvider } from "./local-dev";
export { VaultTransitKmsProvider } from "./vault-transit";
export { DekCache } from "./dek-cache";

let cachedProvider: KmsProvider | null = null;
let cachedDekCache: DekCache | null = null;

/**
 * Pick the configured KMS provider.
 *
 * `VF_KMS_PROVIDER`:
 *   - `local-dev` (default) — `LocalDevKmsProvider`.
 *   - `vault-transit`       — `VaultTransitKmsProvider` (requires Vault env).
 *   - `aws-kms`             — only available when the `cloud/` workspace
 *                             provides an AWS adapter; otherwise throws.
 *
 * Tests use `resetKmsForTests()` to clear the singleton.
 */
export function getKmsProvider(): KmsProvider {
  if (cachedProvider) return cachedProvider;
  const provider = (process.env.VF_KMS_PROVIDER ?? "local-dev").toLowerCase();
  switch (provider) {
    case "local-dev":
      cachedProvider = new LocalDevKmsProvider();
      break;
    case "vault-transit":
      cachedProvider = new VaultTransitKmsProvider({
        address: requireEnv("VF_VAULT_ADDR"),
        token: process.env.VF_VAULT_TOKEN,
        roleId: process.env.VF_VAULT_ROLE_ID,
        secretId: process.env.VF_VAULT_SECRET_ID,
        keyName: process.env.VF_VAULT_TRANSIT_KEY ?? "vectorflow-kek",
        transitMount: process.env.VF_VAULT_TRANSIT_MOUNT ?? "transit",
      });
      break;
    case "aws-kms":
      throw new Error(
        "VF_KMS_PROVIDER=aws-kms requires the cloud/ workspace adapter; not bundled in OSS",
      );
    default:
      throw new Error(`Unknown VF_KMS_PROVIDER value: ${provider}`);
  }
  return cachedProvider;
}

export function getDekCache(): DekCache {
  if (cachedDekCache) return cachedDekCache;
  const ttlMs = Number(process.env.VF_DEK_CACHE_TTL_MS ?? 5 * 60 * 1000);
  cachedDekCache = new DekCache(getKmsProvider(), { ttlMs });
  return cachedDekCache;
}

/** Test-only. Drops the cached provider and DEK cache. */
export function resetKmsForTests(): void {
  cachedDekCache?.invalidateAll();
  cachedProvider = null;
  cachedDekCache = null;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required env var ${name} is not set`);
  return v;
}
