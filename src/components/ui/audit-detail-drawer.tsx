"use client";

import * as React from "react";
import { Copy, X } from "lucide-react";
import { formatTimestamp } from "@/lib/format";
import { getAuditActionLabel } from "@/lib/audit-actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfigDiff } from "@/components/ui/config-diff";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type AuditDetailEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  diff: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userEmail: string | null;
  userName: string | null;
  createdAt: string | Date;
  user?: { name: string | null; email: string | null } | null;
};

interface AuditDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: AuditDetailEntry | null;
  isLoading?: boolean;
}

/**
 * v2 audit detail drawer (g2): timestamp + verb + actor header, object/diff/raw sections.
 */
export function AuditDetailDrawer({
  open,
  onOpenChange,
  entry,
  isLoading = false,
}: AuditDetailDrawerProps) {
  const actor = entry?.userName || entry?.userEmail || entry?.user?.name || entry?.user?.email || "system";
  const rawPayload = entry ? JSON.stringify(entry, null, 2) : "";

  async function copyRaw() {
    if (!rawPayload) return;
    await navigator.clipboard.writeText(rawPayload);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[480px] max-w-[90vw] gap-0 border-line-2 bg-bg-1 p-0 text-fg sm:max-w-[480px]"
      >
        <SheetHeader className="border-b border-line bg-bg-2 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-2">
                {entry ? formatTimestamp(entry.createdAt) : "Audit detail"}
              </div>
              <SheetTitle className="mt-1 flex items-center gap-2 font-mono text-[15px] font-medium text-fg">
                {entry ? (
                  <>
                    <VerbPill action={entry.action} />
                    <span className="truncate">{getAuditActionLabel(entry.action)}</span>
                  </>
                ) : (
                  "Loading…"
                )}
              </SheetTitle>
              <div className="mt-1 font-mono text-[11px] text-fg-2">actor · {actor}</div>
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onOpenChange(false)} aria-label="Close audit detail">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-auto px-4 py-4">
          {isLoading ? (
            <div className="font-mono text-[12px] text-fg-2">Loading audit entry…</div>
          ) : entry ? (
            <div className="space-y-5">
              <Section title="Object">
                <KeyValue label="type" value={entry.entityType} />
                <KeyValue label="id" value={entry.entityId} />
                <KeyValue label="action" value={entry.action} />
                <KeyValue label="ip" value={entry.ipAddress ?? "—"} />
              </Section>

              <Section title="Diff">
                {entry.diff ? (
                  <ConfigDiff
                    oldConfig={stringifyDiffSide(entry.diff, "before")}
                    newConfig={stringifyDiffSide(entry.diff, "after")}
                    oldLabel="before"
                    newLabel="after"
                    className="max-h-72 overflow-auto rounded-[3px] border border-line bg-bg p-3 font-mono text-[11px] leading-5"
                  />
                ) : (
                  <div className="font-mono text-[11.5px] text-fg-2">No diff recorded.</div>
                )}
              </Section>

              <Section title="Raw payload">
                <pre className="max-h-96 overflow-auto rounded-[3px] border border-line bg-bg p-3 font-mono text-[10.5px] leading-5 text-fg-1">
                  {rawPayload}
                </pre>
              </Section>
            </div>
          ) : (
            <div className="font-mono text-[12px] text-fg-2">Select an audit entry.</div>
          )}
        </div>

        <SheetFooter className="mt-0 flex-row justify-end border-t border-line bg-bg-2 px-4 py-3">
          <Button variant="outline" size="sm" onClick={copyRaw} disabled={!entry}>
            <Copy className="h-3.5 w-3.5" />
            Copy raw
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-2">
        {title}
      </h3>
      {children}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-b border-line py-1.5 font-mono text-[11.5px] last:border-b-0">
      <span className="uppercase tracking-[0.04em] text-fg-2">{label}</span>
      <span className="break-all text-fg-1">{value}</span>
    </div>
  );
}

function VerbPill({ action }: { action: string }) {
  return (
    <span className={cn("rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em]", actionClass(action))}>
      {action.split(".")[0]}
    </span>
  );
}

function actionClass(action: string) {
  if (action.includes("deploy")) return "border-accent-line bg-accent-soft text-accent-brand";
  if (action.includes("delete") || action.includes("rollback")) return "border-status-error/40 bg-status-error-bg text-status-error";
  if (action.includes("alert")) return "border-status-degraded/40 bg-status-degraded-bg text-status-degraded";
  if (action.includes("create")) return "border-accent-line bg-accent-soft text-accent-brand";
  return "border-line-2 bg-bg-2 text-fg-1";
}

function stringifyDiffSide(diff: unknown, side: "before" | "after") {
  if (diff && typeof diff === "object") {
    const record = diff as Record<string, unknown>;
    const direct = record[side] ?? record[side === "before" ? "old" : "new"];
    if (direct !== undefined) return JSON.stringify(direct, null, 2);
  }
  return side === "before" ? "" : JSON.stringify(diff, null, 2);
}
