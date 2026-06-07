/**
 * Pure validation utility for node config against a component's configSchema.
 * Used by the flow store to compute hasError / firstErrorMessage at runtime.
 */

export interface NodeValidationResult {
  hasError: boolean;
  firstErrorMessage: string | undefined;
}

interface FieldSchema {
  type?: string;
  format?: string;
  description?: string;
  properties?: Record<string, FieldSchema>;
  required?: string[];
}

interface ConfigSchema {
  properties?: Record<string, FieldSchema>;
  required?: string[];
}

/** Convert snake_case or camelCase to Title Case (mirrors field-renderer.tsx) */
function toTitleCase(str: string): string {
  return str
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Collect "required field missing/invalid" errors for one object level, then
 * recurse into any required field that is itself an object declaring its own
 * `required` (e.g. the OpenTelemetry sink's nested `protocol.uri`). Without the
 * recursion, nested-only required fields pass the editor guard but Vector
 * rejects the generated config at deploy with `missing field ...`.
 */
function collectRequiredErrors(
  config: Record<string, unknown>,
  schema: { properties?: Record<string, FieldSchema>; required?: string[] },
  labelPrefix: string,
  errors: { message: string }[],
): void {
  if (!schema.properties || !schema.required || schema.required.length === 0) {
    return;
  }

  // Sort required fields alphabetically for deterministic ordering.
  const sortedRequired = [...schema.required].sort();

  for (const fieldName of sortedRequired) {
    const fieldSchema = schema.properties[fieldName] ?? {};
    const value = config[fieldName];
    const label = labelPrefix
      ? `${labelPrefix} ${toTitleCase(fieldName)}`
      : toTitleCase(fieldName);
    const isEmpty = value === undefined || value === null || value === "";

    if (isEmpty) {
      errors.push({ message: `${label} is required` });
      continue;
    }

    // Accept deploy-time references as valid placeholder values.
    if (typeof value === "string" && /^(VAR|SECRET|CERT)\[.+]$/.test(value)) {
      continue;
    }

    // Format validation for non-empty string values.
    if (typeof value === "string" && value) {
      if (fieldSchema.format === "uri") {
        try {
          new URL(value);
        } catch {
          errors.push({ message: "Must be a valid URL (e.g. https://...)" });
        }
      } else if (fieldSchema.format === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push({ message: "Must be a valid email address" });
        }
      }
    }

    // Recurse into nested objects that declare their own required fields.
    if (
      fieldSchema.properties &&
      fieldSchema.required &&
      fieldSchema.required.length > 0 &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      collectRequiredErrors(
        value as Record<string, unknown>,
        { properties: fieldSchema.properties, required: fieldSchema.required },
        label,
        errors,
      );
    }
  }
}

/**
 * Validate a node's config object against the configSchema required fields
 * (recursing into nested required). Pure function, no side effects.
 */
export function validateNodeConfig(
  config: Record<string, unknown>,
  configSchema: object,
): NodeValidationResult {
  const errors: { message: string }[] = [];
  collectRequiredErrors(config, configSchema as ConfigSchema, "", errors);

  return {
    hasError: errors.length > 0,
    firstErrorMessage: errors[0]?.message,
  };
}
