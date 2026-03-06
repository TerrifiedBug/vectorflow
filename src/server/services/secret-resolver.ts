import { prisma } from "@/lib/prisma";
import { decrypt } from "./crypto";

const SECRET_REF_PATTERN = /^SECRET\[(.+)]$/;
const CERT_REF_PATTERN = /^CERT\[(.+)]$/;

export interface CertFile {
  name: string;
  filename: string;
  data: string;
}

/**
 * Walk a config object and resolve any SECRET[name] references
 * to their actual decrypted values from the environment's secret store.
 */
export async function resolveSecretRefs(
  config: Record<string, unknown>,
  environmentId: string,
): Promise<Record<string, unknown>> {
  const refs = new Set<string>();
  collectStringRefs(config, SECRET_REF_PATTERN, refs);

  if (refs.size === 0) return config;

  const secrets = await prisma.secret.findMany({
    where: {
      environmentId,
      name: { in: Array.from(refs) },
    },
  });

  const secretMap = new Map<string, string>();
  for (const secret of secrets) {
    secretMap.set(secret.name, decrypt(secret.encryptedValue));
  }

  for (const ref of refs) {
    if (!secretMap.has(ref)) {
      throw new Error(`Secret "${ref}" not found in environment`);
    }
  }

  return replaceStringRefs(config, SECRET_REF_PATTERN, secretMap);
}

/**
 * Walk a config object, resolve CERT[name] references to file paths,
 * and return the list of certificate files that need to be deployed.
 * Config values are replaced with the path where the cert file will live.
 */
export async function resolveCertRefs(
  config: Record<string, unknown>,
  environmentId: string,
  certBasePath: string,
): Promise<{ config: Record<string, unknown>; certFiles: CertFile[] }> {
  const refs = new Set<string>();
  collectStringRefs(config, CERT_REF_PATTERN, refs);

  if (refs.size === 0) return { config, certFiles: [] };

  const certs = await prisma.certificate.findMany({
    where: {
      environmentId,
      name: { in: Array.from(refs) },
    },
  });

  const certMap = new Map<string, { filename: string; data: string }>();
  for (const cert of certs) {
    certMap.set(cert.name, {
      filename: cert.filename,
      data: decrypt(cert.encryptedData),
    });
  }

  for (const ref of refs) {
    if (!certMap.has(ref)) {
      throw new Error(`Certificate "${ref}" not found in environment`);
    }
  }

  // Build path map: cert name → deploy path
  const pathMap = new Map<string, string>();
  const certFiles: CertFile[] = [];
  for (const [name, cert] of certMap) {
    const deployPath = `${certBasePath}/${cert.filename}`;
    pathMap.set(name, deployPath);
    certFiles.push({ name, filename: cert.filename, data: cert.data });
  }

  const resolved = replaceStringRefs(config, CERT_REF_PATTERN, pathMap);
  return { config: resolved, certFiles };
}

/**
 * Walk a config object and convert SECRET[name] references to
 * ${VF_SECRET_NAME} env var placeholders for Vector interpolation.
 * Pure string transformation — no DB lookups or decryption.
 */
export function convertSecretRefsToEnvVars(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return walkConvertSecretRefs(config);
}

function walkConvertSecretRefs(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      const match = value.match(SECRET_REF_PATTERN);
      if (match) {
        result[key] = `\${VF_SECRET_${match[1]}}`;
      } else {
        result[key] = value;
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = walkConvertSecretRefs(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function collectStringRefs(
  obj: Record<string, unknown>,
  pattern: RegExp,
  refs: Set<string>,
): void {
  for (const value of Object.values(obj)) {
    if (typeof value === "string") {
      const match = value.match(pattern);
      if (match) refs.add(match[1]);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      collectStringRefs(value as Record<string, unknown>, pattern, refs);
    }
  }
}

function replaceStringRefs(
  obj: Record<string, unknown>,
  pattern: RegExp,
  valueMap: Map<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      const match = value.match(pattern);
      if (match && valueMap.has(match[1])) {
        result[key] = valueMap.get(match[1]);
      } else {
        result[key] = value;
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = replaceStringRefs(value as Record<string, unknown>, pattern, valueMap);
    } else {
      result[key] = value;
    }
  }

  return result;
}
