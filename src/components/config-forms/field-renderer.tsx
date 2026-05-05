"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SecretPickerInput } from "./secret-picker-input";
import { CertPickerInput, isCertFileField } from "./cert-picker-input";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FieldSchema {
  type?: string;
  description?: string;
  format?: string; // e.g., "uri", "email"
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

/** Validate a field value against schema constraints */
function validateField(
  value: unknown,
  schema: FieldSchema,
  label: string,
  required?: boolean
): string | null {
  if (required && (value === undefined || value === null || value === "")) {
    return `${label} is required`;
  }
  if (typeof value === "string" && value && schema.format === "uri") {
    try { new URL(value); } catch { return "Must be a valid URL (e.g. https://...)"; }
  }
  if (typeof value === "string" && value && schema.format === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return "Must be a valid email address";
    }
  }
  return null;
}

/** Determine if a field is "complex" and deserves a HelpCircle tooltip */
function isComplexField(name: string, schema: FieldSchema): boolean {
  const lower = name.toLowerCase();
  return (
    schema.type === "object" ||
    lower.includes("auth") ||
    lower.includes("tls") ||
    lower.includes("strategy") ||
    lower.includes("codec") ||
    (typeof schema.description === "string" && schema.description.length > 80)
  );
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

  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBlur = () => {
    setTouched(true);
    setError(validateField(value, schema, label, required));
  };

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

  const showHelpIcon = isComplexField(name, schema);
  const labelClass =
    "font-mono uppercase tracking-[0.04em] text-[10.5px] text-fg-2";
  const descriptionClass = "text-[11px] text-fg-2";

  const labelRow = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Label className={labelClass}>
          {label}
          {required && (
            <span className="ml-0.5 text-status-error" aria-hidden>
              *
            </span>
          )}
        </Label>
        {showHelpIcon && schema.description && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3 cursor-help text-fg-2" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-[11px]">
                {schema.description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );

  const errorMessage = touched && error ? (
    <p className={cn("mt-1 font-mono text-[10.5px] text-status-error")}>
      {error}
    </p>
  ) : null;

  const errorInputClass = "border-status-error aria-invalid:border-status-error focus-visible:border-status-error focus-visible:ring-[color:var(--status-error)]/20";

  // ---- Enum select ----
  if (schema.enum && schema.enum.length > 0) {
    return (
      <div className="space-y-1.5">
        {labelRow}
        <Select
          value={(value as string) ?? ""}
          onValueChange={(v) => {
            onChange(v);
            if (touched) setError(validateField(v, schema, label, required));
          }}
          onOpenChange={(open) => { if (!open) handleBlur(); }}
        >
          <SelectTrigger className="h-7 w-full rounded-[3px] border-line-2 bg-bg-2 text-[12px]">
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
          <p className={descriptionClass}>{schema.description}</p>
        )}
        {errorMessage}
      </div>
    );
  }

  // ---- Boolean switch ----
  if (schema.type === "boolean") {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          {labelRow}
          {schema.description && (
            <p className={descriptionClass}>{schema.description}</p>
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
      <div className="space-y-1.5">
        {labelRow}
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
          onBlur={handleBlur}
          placeholder={
            schema.default !== undefined ? String(schema.default) : undefined
          }
          aria-invalid={touched && !!error}
          className={cn(touched && error && errorInputClass)}
        />
        {schema.description && (
          <p className={descriptionClass}>{schema.description}</p>
        )}
        {errorMessage}
      </div>
    );
  }

  // ---- Array of strings (comma-separated) ----
  if (schema.type === "array" && schema.items?.type === "string") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-1.5">
        {labelRow}
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
          onBlur={handleBlur}
          placeholder="value1, value2, value3"
          aria-invalid={touched && !!error}
          className={cn(touched && error && errorInputClass)}
        />
        {schema.description && (
          <p className={descriptionClass}>{schema.description}</p>
        )}
        {errorMessage}
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
      <div className="space-y-1.5">
        {labelRow}
        {schema.description && (
          <p className={descriptionClass}>{schema.description}</p>
        )}
        <div className="space-y-2 border-l border-line pl-3">
          {entries.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-1.5">
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
                aria-label={`Remove ${k}`}
                className="px-1 text-fg-2 hover:text-status-error"
                onClick={() => {
                  const obj = { ...((value as Record<string, string>) ?? {}) };
                  delete obj[k];
                  onChange(obj);
                }}
              >
                <span className="font-mono text-[12px]">✕</span>
              </button>
            </div>
          ))}
          <button
            type="button"
            className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2 hover:text-fg"
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
      <div className="space-y-2">
        {labelRow}
        {schema.description && (
          <p className={descriptionClass}>{schema.description}</p>
        )}
        <div className="space-y-3 border-l border-line pl-3">
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
    <div className="space-y-1.5">
      {labelRow}
      {isMultiline ? (
        <Textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
          rows={4}
          aria-invalid={touched && !!error}
          className={cn(
            "rounded-[3px] border-line-2 bg-bg-2 text-[12px]",
            touched && error && errorInputClass,
          )}
        />
      ) : isSensitive ? (
        <SecretPickerInput
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
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
          onBlur={handleBlur}
          placeholder={placeholder}
          aria-invalid={touched && !!error}
          className={cn(touched && error && errorInputClass)}
        />
      )}
      {schema.description && (
        <p className={descriptionClass}>{schema.description}</p>
      )}
      {errorMessage}
    </div>
  );
}

