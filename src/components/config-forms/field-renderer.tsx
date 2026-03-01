"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SecretPickerInput } from "./secret-picker-input";
import { CertPickerInput, isCertFileField } from "./cert-picker-input";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FieldSchema {
  type?: string;
  description?: string;
  enum?: string[];
  items?: { type?: string };
  properties?: Record<string, FieldSchema>;
  additionalProperties?: { type?: string };
  required?: string[];
  default?: unknown;
  sensitive?: boolean;
  dependsOn?: { field: string; value: string | string[] };
}

export interface FieldRendererProps {
  name: string;
  schema: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  required?: boolean;
  parentValues?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Convert snake_case or camelCase to Title Case */
function toTitleCase(str: string): string {
  return str
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Check whether the field name hints at multiline content */
function isMultilineName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("source") || lower.includes("program") || lower.includes("condition");
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function FieldRenderer({
  name,
  schema,
  value,
  onChange,
  required,
  parentValues,
}: FieldRendererProps) {
  const label = toTitleCase(name);

  // Check conditional visibility
  if (schema.dependsOn && parentValues) {
    const depValue = parentValues[schema.dependsOn.field];
    const allowedValues = Array.isArray(schema.dependsOn.value)
      ? schema.dependsOn.value
      : [schema.dependsOn.value];
    if (!allowedValues.includes(depValue as string)) {
      return null;
    }
  }

  // ---- Enum select ----
  if (schema.enum && schema.enum.length > 0) {
    return (
      <div className="space-y-2">
        <Label>
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        <Select
          value={(value as string) ?? ""}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {schema.enum.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {schema.description && (
          <p className="text-xs text-muted-foreground">{schema.description}</p>
        )}
      </div>
    );
  }

  // ---- Boolean switch ----
  if (schema.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label>
            {label}
            {required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
          {schema.description && (
            <p className="text-xs text-muted-foreground">
              {schema.description}
            </p>
          )}
        </div>
        <Switch
          checked={typeof value === "boolean" ? value : (schema.default as boolean) ?? false}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    );
  }

  // ---- Number / Integer ----
  if (schema.type === "number" || schema.type === "integer") {
    return (
      <div className="space-y-2">
        <Label>
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        <Input
          type="number"
          value={value !== undefined && value !== null ? String(value) : ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(undefined);
              return;
            }
            const parsed =
              schema.type === "integer"
                ? parseInt(raw, 10)
                : parseFloat(raw);
            if (!isNaN(parsed)) onChange(parsed);
          }}
          placeholder={
            schema.default !== undefined ? String(schema.default) : undefined
          }
        />
        {schema.description && (
          <p className="text-xs text-muted-foreground">{schema.description}</p>
        )}
      </div>
    );
  }

  // ---- Array of strings (comma-separated) ----
  if (schema.type === "array" && schema.items?.type === "string") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-2">
        <Label>
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        <Input
          value={arr.join(", ")}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw.trim() === "") {
              onChange([]);
              return;
            }
            onChange(raw.split(",").map((s) => s.trim()));
          }}
          placeholder="value1, value2, value3"
        />
        {schema.description && (
          <p className="text-xs text-muted-foreground">{schema.description}</p>
        )}
      </div>
    );
  }

  // ---- Key-value map (object with additionalProperties, no fixed properties) ----
  if (
    schema.type === "object" &&
    schema.additionalProperties &&
    !schema.properties
  ) {
    const entries = Object.entries(
      (value as Record<string, string>) ?? {},
    );
    return (
      <div className="space-y-2">
        <Label>
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        {schema.description && (
          <p className="text-xs text-muted-foreground">
            {schema.description}
          </p>
        )}
        <div className="space-y-2 border-l-2 border-border pl-4">
          {entries.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                className="flex-1"
                placeholder="Key"
                value={k}
                onChange={(e) => {
                  const obj = { ...((value as Record<string, string>) ?? {}) };
                  const oldVal = obj[k];
                  delete obj[k];
                  if (e.target.value) obj[e.target.value] = oldVal ?? "";
                  onChange(obj);
                }}
              />
              <Input
                className="flex-1"
                placeholder="Value"
                value={v}
                onChange={(e) => {
                  onChange({
                    ...((value as Record<string, string>) ?? {}),
                    [k]: e.target.value,
                  });
                }}
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive text-sm px-1"
                onClick={() => {
                  const obj = { ...((value as Record<string, string>) ?? {}) };
                  delete obj[k];
                  onChange(obj);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              onChange({
                ...((value as Record<string, string>) ?? {}),
                "": "",
              });
            }}
          >
            + Add entry
          </button>
        </div>
      </div>
    );
  }

  // ---- Nested object ----
  if (schema.type === "object" && schema.properties) {
    const objValue = (value as Record<string, unknown>) ?? {};
    const requiredFields = schema.required ?? [];
    return (
      <div className="space-y-3">
        <Label>
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        {schema.description && (
          <p className="text-xs text-muted-foreground">{schema.description}</p>
        )}
        <div className="space-y-3 border-l-2 border-border pl-4">
          {Object.entries(schema.properties).map(([key, propSchema]) => (
            <FieldRenderer
              key={key}
              name={key}
              schema={propSchema}
              value={objValue[key]}
              onChange={(fieldValue) =>
                onChange({ ...objValue, [key]: fieldValue })
              }
              required={requiredFields.includes(key)}
              parentValues={objValue}
            />
          ))}
        </div>
      </div>
    );
  }

  // ---- String (default) ----
  const isMultiline = isMultilineName(name);
  const isSensitive = schema.sensitive === true || /password|secret|token|api_key/i.test(name);
  const isCertFile = isCertFileField(name);
  const placeholder = schema.default !== undefined ? String(schema.default) : undefined;

  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {isMultiline ? (
        <Textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={4}
        />
      ) : isSensitive ? (
        <SecretPickerInput
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
          placeholder={placeholder}
        />
      ) : isCertFile ? (
        <CertPickerInput
          fieldName={name}
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
        />
      ) : (
        <Input
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      {schema.description && (
        <p className="text-xs text-muted-foreground">{schema.description}</p>
      )}
    </div>
  );
}
