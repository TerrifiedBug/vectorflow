"use client";

import { FieldRenderer } from "./field-renderer";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SchemaFormProps {
  schema: {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SchemaForm({ schema, values, onChange }: SchemaFormProps) {
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No configurable properties.
      </p>
    );
  }

  const requiredFields = schema.required ?? [];

  return (
    <div className="space-y-4">
      {Object.entries(schema.properties).map(([key, propSchema]) => (
        <FieldRenderer
          key={key}
          name={key}
          schema={propSchema}
          value={values[key]}
          onChange={(fieldValue) => {
            onChange({ ...values, [key]: fieldValue });
          }}
          required={requiredFields.includes(key)}
        />
      ))}
    </div>
  );
}
