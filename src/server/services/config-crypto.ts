import { encrypt, decrypt } from "./crypto";
import { findComponentDef } from "@/lib/vector/catalog";
import type { VectorComponentDef } from "@/lib/vector/types";

const ENCRYPTED_PREFIX = "enc:";

interface SchemaNode {
  type?: string;
  sensitive?: boolean;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
}

/**
 * Walk a config object and encrypt all fields marked `sensitive: true`
 * in the component's catalog schema, or matching known sensitive name patterns.
 */
function processConfig(
  config: Record<string, unknown>,
  schema: SchemaNode | undefined,
  mode: "encrypt" | "decrypt",
): Record<string, unknown> {
  if (!schema?.properties) return config;

  const result: Record<string, unknown> = { ...config };

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const value = result[key];
    if (value === undefined || value === null) continue;

    // Recurse into nested objects
    if (
      propSchema.type === "object" &&
      propSchema.properties &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = processConfig(
        value as Record<string, unknown>,
        propSchema,
        mode,
      );
      continue;
    }

    // Check if this field is sensitive
    const isSensitive =
      propSchema.sensitive === true ||
      /password|secret|token|api_key/i.test(key);

    if (!isSensitive || typeof value !== "string" || value === "") continue;

    if (mode === "encrypt") {
      // Don't double-encrypt
      if (value.startsWith(ENCRYPTED_PREFIX)) continue;
      result[key] = ENCRYPTED_PREFIX + encrypt(value);
    } else {
      // Only decrypt if it looks encrypted
      if (!value.startsWith(ENCRYPTED_PREFIX)) continue;
      try {
        result[key] = decrypt(value.slice(ENCRYPTED_PREFIX.length));
      } catch {
        // If decryption fails (e.g. key changed), leave as-is
        result[key] = value;
      }
    }
  }

  return result;
}

function getSchemaForComponent(
  componentType: string,
  kind?: VectorComponentDef["kind"],
): SchemaNode | undefined {
  const def = findComponentDef(componentType, kind);
  return def?.configSchema as SchemaNode | undefined;
}

/**
 * Encrypt sensitive fields in a pipeline node's config before saving to DB.
 */
export function encryptNodeConfig(
  componentType: string,
  config: Record<string, unknown>,
  kind?: VectorComponentDef["kind"],
): Record<string, unknown> {
  const schema = getSchemaForComponent(componentType, kind);
  return processConfig(config, schema, "encrypt");
}

/**
 * Decrypt sensitive fields in a pipeline node's config after loading from DB.
 */
export function decryptNodeConfig(
  componentType: string,
  config: Record<string, unknown>,
  kind?: VectorComponentDef["kind"],
): Record<string, unknown> {
  const schema = getSchemaForComponent(componentType, kind);
  return processConfig(config, schema, "decrypt");
}
