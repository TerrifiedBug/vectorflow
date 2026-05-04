"use client";

import { AlertTriangle, CheckCircle2, GitBranch, MinusCircle, PlusCircle } from "lucide-react";
import type { Edge, Node } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { buildFieldLineage, type FieldLineageStatus } from "@/lib/vector/field-lineage";

interface FieldLineagePanelProps {
  selectedNodeId: string;
  nodes: Node[];
  edges: Edge[];
}

const statusTone: Record<FieldLineageStatus, string> = {
  source: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  added: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  renamed: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
  type_changed: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  removed: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  unchanged: "border-border bg-muted text-muted-foreground",
};

function statusLabel(status: FieldLineageStatus) {
  return status.replace("_", " ");
}

function statusIcon(status: FieldLineageStatus) {
  if (status === "removed") return <MinusCircle className="h-3.5 w-3.5" />;
  if (status === "added" || status === "source") return <PlusCircle className="h-3.5 w-3.5" />;
  return <GitBranch className="h-3.5 w-3.5" />;
}

export function FieldLineagePanel({ selectedNodeId, nodes, edges }: FieldLineagePanelProps) {
  const lineage = buildFieldLineage(nodes, edges, selectedNodeId);
  const activeFields = lineage.fields.filter((field) => field.status !== "removed");
  const removedFields = lineage.fields.filter((field) => field.status === "removed");
  const missingExpectations = lineage.expectations.filter((expectation) => expectation.status === "missing");
  const changedFields = lineage.fields.filter((field) =>
    ["added", "renamed", "type_changed", "removed"].includes(field.status),
  );

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border bg-muted/30 p-2">
          <p className="text-[11px] uppercase text-muted-foreground">Fields</p>
          <p className="text-lg font-semibold tabular-nums">{activeFields.length}</p>
        </div>
        <div className="rounded-md border bg-muted/30 p-2">
          <p className="text-[11px] uppercase text-muted-foreground">Changed</p>
          <p className="text-lg font-semibold tabular-nums">{changedFields.length}</p>
        </div>
        <div className="rounded-md border bg-muted/30 p-2">
          <p className="text-[11px] uppercase text-muted-foreground">Missing</p>
          <p className="text-lg font-semibold tabular-nums">{missingExpectations.length}</p>
        </div>
      </div>

      {lineage.expectations.length > 0 && (
        <section className="space-y-2" aria-labelledby="sink-expectations-heading">
          <h3 id="sink-expectations-heading" className="text-sm font-semibold">
            Sink Expectations
          </h3>
          <div className="space-y-2">
            {lineage.expectations.map((expectation) => (
              <div
                key={expectation.path}
                className="flex items-start gap-2 rounded-md border bg-background p-2"
              >
                {expectation.status === "met" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <code className="truncate text-xs font-semibold">{expectation.path}</code>
                    <Badge variant={expectation.status === "met" ? "secondary" : "destructive"}>
                      {expectation.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{expectation.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2" aria-labelledby="lineage-steps-heading">
        <h3 id="lineage-steps-heading" className="text-sm font-semibold">
          Lineage Steps
        </h3>
        <div className="space-y-2">
          {lineage.steps.map((step) => (
            <div key={step.nodeId} className="rounded-md border bg-background p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{step.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {step.kind} / {step.type}
                  </p>
                </div>
                <Badge variant="outline">{step.changes.length}</Badge>
              </div>
              {step.changes.length > 0 && (
                <div className="mt-2 space-y-1">
                  {step.changes.slice(0, 4).map((change) => (
                    <div key={`${step.nodeId}-${change.path}-${change.status}`} className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">{statusIcon(change.status)}</span>
                      <code className="min-w-0 truncate">{change.path}</code>
                      <span className="truncate text-muted-foreground">{change.description}</span>
                    </div>
                  ))}
                  {step.changes.length > 4 && (
                    <p className="text-xs text-muted-foreground">+{step.changes.length - 4} more changes</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="field-map-heading">
        <h3 id="field-map-heading" className="text-sm font-semibold">
          Field Map
        </h3>
        <div className="space-y-2">
          {[...activeFields, ...removedFields].map((field) => (
            <div key={field.path} className="rounded-md border bg-background p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <code className="block truncate text-xs font-semibold">{field.path}</code>
                  {field.previousPath && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      from <code>{field.previousPath}</code>
                    </p>
                  )}
                </div>
                <Badge variant="outline" className={statusTone[field.status]}>
                  {statusLabel(field.status)}
                </Badge>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{field.type}</span>
                <span className="truncate">{field.sourceComponent}</span>
              </div>
            </div>
          ))}
          {lineage.fields.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No static field schema is available for this path yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
