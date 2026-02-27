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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FieldSchema {
  type?: string;
  description?: string;
  enum?: string[];
  items?: { type?: string };
  properties?: Record<string, FieldSchema>;
  required?: string[];
  default?: unknown;
}

export interface FieldRendererProps {
  name: string;
  schema: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  required?: boolean;
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
}: FieldRendererProps) {
  const label = toTitleCase(name);

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
            />
          ))}
        </div>
      </div>
    );
  }

  // ---- String (default) ----
  const isMultiline = isMultilineName(name);
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
          placeholder={
            schema.default !== undefined ? String(schema.default) : undefined
          }
          rows={4}
        />
      ) : (
        <Input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            schema.default !== undefined ? String(schema.default) : undefined
          }
        />
      )}
      {schema.description && (
        <p className="text-xs text-muted-foreground">{schema.description}</p>
      )}
    </div>
  );
}
