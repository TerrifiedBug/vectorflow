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
 * Validate a node's config object against the configSchema required fields.
 * Returns { hasError, firstErrorMessage } — pure function, no side effects.
 */
export function validateNodeConfig(
  config: Record<string, unknown>,
  configSchema: object,
): NodeValidationResult {
  const schema = configSchema as ConfigSchema;

  if (!schema.properties || !schema.required || schema.required.length === 0) {
    return { hasError: false, firstErrorMessage: undefined };
  }

  const errors: { fieldName: string; message: string }[] = [];

  // Sort required fields alphabetically for deterministic ordering
  const sortedRequired = [...schema.required].sort();

  for (const fieldName of sortedRequired) {
    const fieldSchema = schema.properties[fieldName] ?? {};
    const value = config[fieldName];
    const isEmpty = value === undefined || value === null || value === "";

    if (isEmpty) {
      errors.push({
        fieldName,
        message: `${toTitleCase(fieldName)} is required`,
      });
      continue;
    }

    // Format validation for non-empty values
    if (typeof value === "string" && value) {
      if (fieldSchema.format === "uri") {
        try {
          new URL(value);
        } catch {
          errors.push({
            fieldName,
            message: "Must be a valid URL (e.g. https://...)",
          });
        }
      } else if (fieldSchema.format === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push({
            fieldName,
            message: "Must be a valid email address",
          });
        }
      }
    }
  }

  return {
    hasError: errors.length > 0,
    firstErrorMessage: errors[0]?.message,
  };
}
