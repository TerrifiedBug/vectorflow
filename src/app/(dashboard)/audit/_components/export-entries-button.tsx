"use client";

/**
 * Filtered audit-entry export (CSV / JSON).
 *
 * Distinct from the chain-verifiable export (`AuditChainExportButton`):
 * this control downloads the rows that match the audit page's CURRENT
 * filter state via the `audit.exportAuditLog` query (ADMIN-gated, capped
 * at 10,000 rows server-side). The export is user-initiated, so it fetches
 * imperatively through `queryClient.fetchQuery` rather than holding a
 * standing `useQuery` subscription.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, FileDown, Loader2 } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";

import { useTRPC } from "@/trpc/client";
import type { AppRouter } from "@/trpc/router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Mirror of `audit.exportAuditLog` input — the same fields page.tsx feeds to `audit.list`. */
export type AuditExportFilters = {
  action?: string;
  userId?: string;
  entityTypes?: string[];
  search?: string;
  teamId?: string;
  environmentId?: string;
  startDate?: string;
  endDate?: string;
};

type AuditExportRow =
  inferRouterOutputs<AppRouter>["audit"]["exportAuditLog"]["items"][number];

type ExportFormat = "csv" | "json";

/** Keep in sync with the server-side cap in `audit.exportAuditLog`. */
const MAX_EXPORT_ROWS = 10_000;

/**
 * Flat, stable CSV columns. Header label co-located with its accessor so
 * the two never drift. `diff`/`metadata` JSON blobs and the tamper-chain
 * hashes are intentionally omitted (the chain export owns those).
 */
const CSV_COLUMNS: ReadonlyArray<{
  header: string;
  get: (row: AuditExportRow) => unknown;
}> = [
  { header: "id", get: (r) => r.id },
  { header: "createdAt", get: (r) => r.createdAt },
  { header: "action", get: (r) => r.action },
  { header: "entityType", get: (r) => r.entityType },
  { header: "entityId", get: (r) => r.entityId },
  { header: "userEmail", get: (r) => r.user?.email ?? r.userEmail ?? "-" },
  { header: "userName", get: (r) => r.userName ?? r.user?.name ?? "-" },
  { header: "ipAddress", get: (r) => r.ipAddress ?? "-" },
  { header: "teamId", get: (r) => r.teamId ?? "-" },
  { header: "environmentId", get: (r) => r.environmentId ?? "-" },
];

/** RFC 4180 escaping: quote-wrap when the value holds a quote, comma, or newline. */
function csvCell(value: unknown): string {
  if (value == null) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildCsv(rows: AuditExportRow[]): string {
  const header = CSV_COLUMNS.map((c) => c.header).join(",");
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((c) => csvCell(c.get(row))).join(","),
  );
  return [header, ...lines].join("\r\n");
}

function downloadFile(
  contents: string,
  mimeType: string,
  extension: ExportFormat,
): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportEntriesButton({
  filters,
}: {
  filters: AuditExportFilters;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [isExporting, setIsExporting] = useState(false);

  async function handleExport(formatType: ExportFormat) {
    setIsExporting(true);
    try {
      // Imperative one-shot fetch — exports are user-initiated, not a
      // standing subscription. staleTime: 0 forces fresh rows so a cached
      // hit can't silently drop recent activity from the download.
      const data = await queryClient.fetchQuery({
        ...trpc.audit.exportAuditLog.queryOptions(filters),
        staleTime: 0,
      });

      if (data.items.length === 0) {
        toast.error("No entries match the current filters");
        return;
      }

      if (formatType === "json") {
        downloadFile(
          JSON.stringify(data.items, null, 2),
          "application/json",
          "json",
        );
      } else {
        downloadFile(buildCsv(data.items), "text/csv;charset=utf-8", "csv");
      }

      const exported = data.items.length.toLocaleString();
      if (data.totalCount > data.items.length) {
        toast.message(
          `Exported the first ${exported} of ${data.totalCount.toLocaleString()} matching entries (capped at ${MAX_EXPORT_ROWS.toLocaleString()}). Narrow the filters to export a smaller slice.`,
        );
      } else {
        toast.success(
          `Exported ${exported} ${formatType.toUpperCase()} ${data.items.length === 1 ? "entry" : "entries"}.`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed", {
        duration: 6000,
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={isExporting}
          className="gap-1.5"
          aria-label="Export filtered audit entries"
        >
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="h-4 w-4" />
          )}
          Export entries
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Matches current filters · up to {MAX_EXPORT_ROWS.toLocaleString()} rows
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isExporting}
          onSelect={() => handleExport("csv")}
        >
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isExporting}
          onSelect={() => handleExport("json")}
        >
          Export as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
