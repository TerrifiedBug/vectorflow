// src/components/analytics/cost-csv-export.tsx
"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CostCsvExportProps {
  environmentId: string;
  range: string;
}

export function CostCsvExport({ environmentId, range }: CostCsvExportProps) {
  const handleExport = async () => {
    try {
      // Use tRPC to fetch CSV data (avoids needing separate auth for REST)
      const response = await fetch(
        `/api/v1/analytics/costs/export?environmentId=${encodeURIComponent(environmentId)}&range=${encodeURIComponent(range)}`
      );

      if (!response.ok) {
        // Fall back to tRPC-generated CSV if REST auth fails
        // (service accounts vs session auth)
        const blob = await generateCsvViaTrpc();
        downloadBlob(blob);
        return;
      }

      const blob = await response.blob();
      downloadBlob(blob);
    } catch {
      // Fallback: generate CSV client-side from tRPC data
      const blob = await generateCsvViaTrpc();
      downloadBlob(blob);
    }
  };

  const generateCsvViaTrpc = async (): Promise<Blob> => {
    const res = await fetch(
      `/api/trpc/analytics.costCsv?input=${encodeURIComponent(
        JSON.stringify({ environmentId, range })
      )}`
    );
    const json = await res.json();
    const csv = json?.result?.data?.csv ?? "";
    return new Blob([csv], { type: "text/csv" });
  };

  const downloadBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cost-report-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void handleExport()}
      className="gap-1.5"
    >
      <Download className="h-3.5 w-3.5" />
      Export CSV
    </Button>
  );
}
