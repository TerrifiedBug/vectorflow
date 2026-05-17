"use client";

/**
 * Chain-verifiable audit log download (plan §16b OSS-10).
 *
 * Triggers the `audit.exportChain` tRPC procedure (per-org, super-admin
 * gets the full chain; team-scoped members get a partial view marked
 * `partial: true` in the metadata) and saves the resulting envelope as
 * a JSON file. The bundled `scripts/verify-audit-chain.ts` reads this
 * file to detect tampering.
 *
 * Network: this can be a big response (50k row cap), so the click flow
 * disables the button + shows a "preparing…" affordance while the
 * tRPC query runs.
 */

import { useState } from "react";
import { Download, ShieldCheck } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AuditChainExportButton() {
  const trpc = useTRPC();
  const [isExporting, setIsExporting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  async function handleExport() {
    setIsExporting(true);
    setLastError(null);
    try {
      // Use the tRPC vanilla client so we can run this once on click
      // without registering a long-lived react-query.
      const { envelope, rowCount, partial } =
        await trpc.audit.exportChain.query();

      const blob = new Blob([envelope], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `audit-chain-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Surface a one-line summary so the operator knows what they got.
      const summary = `Exported ${rowCount} chained audit rows${
        partial ? " (partial — team-scoped view)" : ""
      }.`;
      // We don't use a toast lib here to avoid taking a hard dep; if
      // the page wraps a Toaster elsewhere, swap this for toast.success.
      // eslint-disable-next-line no-console
      console.info("[audit-chain-export]", summary);
    } catch (err) {
      setLastError(
        err instanceof Error ? err.message : "Audit export failed",
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
            aria-label="Download chain-verifiable audit log"
            className="gap-1.5"
          >
            {isExporting ? (
              <>
                <ShieldCheck className="h-4 w-4 animate-pulse" />
                Preparing…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export chain
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px]">
          Download a chain-verifiable JSON export of this org&apos;s audit
          log. Use the bundled <code>verify-audit-chain.ts</code> script
          to detect tampering.
          {lastError ? (
            <div className="mt-2 text-red-500">{lastError}</div>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
