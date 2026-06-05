"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Send, Trash2 } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import { formatTimestamp } from "@/lib/format";

const COMPARATOR_LABEL: Record<string, string> = {
  GT: ">",
  GTE: "≥",
  LT: "<",
  LTE: "≤",
};

/** Best-effort read of the metric label from a rule's stored JSON spec. */
function metricLabelOf(spec: unknown): string {
  if (!spec || typeof spec !== "object") return "?";
  const s = spec as Record<string, unknown>;
  const metric = typeof s.metric === "string" ? s.metric : "?";
  if (metric === "count") return "count";
  const field = typeof s.metricField === "string" ? s.metricField : "?";
  return `${metric}(${field})`;
}

export function LakeAlertsPanel({ teamId, lakeEnabled }: { teamId: string; lakeEnabled: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const rulesQuery = useQuery({
    ...trpc.lake.alert.list.queryOptions({ teamId }),
    enabled: !!teamId && lakeEnabled,
  });
  const rules = rulesQuery.data ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: trpc.lake.alert.list.queryKey() });
  }

  const updateMutation = useMutation(
    trpc.lake.alert.update.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error(e.message),
    }),
  );
  const deleteMutation = useMutation(
    trpc.lake.alert.delete.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success("Alert rule deleted");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const testMutation = useMutation(
    trpc.lake.alert.testFire.mutationOptions({
      onSuccess: (r) => {
        toast.success(
          r.delivered
            ? `Test sent (current value ${r.value ?? "n/a"})`
            : `Evaluated: current value ${r.value ?? "n/a"} (no channel delivery)`,
        );
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  if (rules.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="No alert rules"
        description="Run a Summarize, then use “Alert on this query” to get notified when a metric crosses a threshold."
        compact
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {rules.map((rule) => (
        <li key={rule.id} className="flex items-center gap-3 py-2.5">
          <Switch
            checked={rule.enabled}
            onCheckedChange={(checked) =>
              updateMutation.mutate({ id: rule.id, pipelineId: rule.pipelineId, enabled: checked })
            }
            aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{rule.name}</span>
              {rule.firing && (
                <Badge variant="secondary" className="bg-red-500/10 text-red-600 dark:text-red-400">
                  firing
                </Badge>
              )}
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              {metricLabelOf(rule.spec)} {COMPARATOR_LABEL[rule.comparator] ?? rule.comparator}{" "}
              {rule.threshold}
              {rule.lastValue !== null && rule.lastValue !== undefined
                ? ` · last ${rule.lastValue}`
                : ""}
              {rule.lastFiredAt ? ` · fired ${formatTimestamp(String(rule.lastFiredAt))}` : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={testMutation.isPending}
            onClick={() => testMutation.mutate({ id: rule.id, pipelineId: rule.pipelineId })}
          >
            <Send className="h-3.5 w-3.5" />
            Test
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label="Delete rule"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate({ id: rule.id, pipelineId: rule.pipelineId })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
