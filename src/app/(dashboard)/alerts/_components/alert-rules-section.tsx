"use client";

import { useState, useCallback } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import { AlertMetric, AlertCondition } from "@/generated/prisma";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { isEventMetric } from "@/lib/alert-metrics";

import {
  METRIC_LABELS,
  CONDITION_LABELS,
  BINARY_METRICS,
  GLOBAL_METRICS,
  CHANNEL_TYPE_LABELS,
} from "./constants";

// ─── Alert Rules Section ────────────────────────────────────────────────────────

interface RuleFormState {
  name: string;
  pipelineId: string;
  metric: string;
  condition: string;
  threshold: string;
  durationSeconds: string;
  channelIds: string[];
}

const EMPTY_RULE_FORM: RuleFormState = {
  name: "",
  pipelineId: "",
  metric: "",
  condition: "",
  threshold: "",
  durationSeconds: "60",
  channelIds: [],
};

export function AlertRulesSection({ environmentId }: { environmentId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_RULE_FORM);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const rulesQuery = useQuery(
    trpc.alert.listRules.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );

  const pipelinesQuery = useQuery(
    trpc.pipeline.list.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );

  const channelsQuery = useQuery(
    trpc.alert.listChannels.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );

  const invalidateRules = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: trpc.alert.listRules.queryKey({ environmentId }),
    });
  }, [queryClient, trpc, environmentId]);

  const createMutation = useMutation(
    trpc.alert.createRule.mutationOptions({
      onSuccess: () => {
        toast.success("Alert rule created");
        invalidateRules();
        setDialogOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create alert rule");
      },
    }),
  );

  const updateMutation = useMutation(
    trpc.alert.updateRule.mutationOptions({
      onSuccess: () => {
        toast.success("Alert rule updated");
        invalidateRules();
        setDialogOpen(false);
        setEditingRuleId(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update alert rule");
      },
    }),
  );

  const toggleMutation = useMutation(
    trpc.alert.updateRule.mutationOptions({
      onSuccess: () => {
        invalidateRules();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to toggle alert rule");
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.alert.deleteRule.mutationOptions({
      onSuccess: () => {
        toast.success("Alert rule deleted");
        invalidateRules();
        setDeleteTarget(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete alert rule");
      },
    }),
  );

  const rules = rulesQuery.data ?? [];
  const pipelines = pipelinesQuery.data ?? [];
  const channels = channelsQuery.data ?? [];

  const openCreate = () => {
    setEditingRuleId(null);
    setForm(EMPTY_RULE_FORM);
    setDialogOpen(true);
  };

  const openEdit = (rule: (typeof rules)[0]) => {
    setEditingRuleId(rule.id);
    const skipThreshold = isEventMetric(rule.metric) || BINARY_METRICS.has(rule.metric);
    setForm({
      name: rule.name,
      pipelineId: rule.pipelineId ?? "",
      metric: rule.metric,
      condition: skipThreshold ? "" : (rule.condition ?? "gt"),
      threshold: skipThreshold ? "" : String(rule.threshold ?? ""),
      durationSeconds: skipThreshold ? "" : String(rule.durationSeconds ?? ""),
      channelIds: rule.channels?.map((c) => c.channelId) ?? [],
    });
    setDialogOpen(true);
  };

  const toggleChannel = (channelId: string) => {
    setForm((f) => ({
      ...f,
      channelIds: f.channelIds.includes(channelId)
        ? f.channelIds.filter((id) => id !== channelId)
        : [...f.channelIds, channelId],
    }));
  };

  const handleSubmit = () => {
    const isBinary = BINARY_METRICS.has(form.metric);
    const isEvent = isEventMetric(form.metric);
    if (!form.name || !form.metric || (!isBinary && !isEvent && !form.threshold)) {
      toast.error("Please fill in all required fields");
      return;
    }

    const skipThreshold = isEvent || isBinary;

    if (editingRuleId) {
      updateMutation.mutate({
        id: editingRuleId,
        name: form.name,
        ...(skipThreshold
          ? {}
          : {
              threshold: parseFloat(form.threshold),
              durationSeconds: parseInt(form.durationSeconds, 10) || 60,
            }),
        channelIds: form.channelIds,
      });
    } else {
      createMutation.mutate({
        name: form.name,
        environmentId,
        pipelineId: form.pipelineId || undefined,
        metric: form.metric as AlertMetric,
        condition: skipThreshold ? null : (form.condition as AlertCondition),
        threshold: skipThreshold ? null : parseFloat(form.threshold),
        durationSeconds: skipThreshold ? null : (parseInt(form.durationSeconds, 10) || 60),
        teamId: selectedTeamId!,
        channelIds: form.channelIds.length > 0 ? form.channelIds : undefined,
      });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Rule
        </Button>
      </div>

      {rulesQuery.isError ? (
        <QueryError message="Failed to load alert rules" onRetry={() => rulesQuery.refetch()} />
      ) : rulesQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <EmptyState title="No alert rules configured" description="Create an alert rule to monitor metrics and receive notifications." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Metric</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Threshold</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Pipeline</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {METRIC_LABELS[rule.metric] ?? rule.metric}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono">
                  {BINARY_METRICS.has(rule.metric) || !rule.condition ? "—" : (CONDITION_LABELS[rule.condition] ?? rule.condition)}
                </TableCell>
                <TableCell className="font-mono">
                  {BINARY_METRICS.has(rule.metric) ? "—" : (rule.threshold ?? "—")}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {BINARY_METRICS.has(rule.metric) || rule.durationSeconds == null ? "—" : `${rule.durationSeconds}s`}
                </TableCell>
                <TableCell>
                  {GLOBAL_METRICS.has(rule.metric) ? (
                    <span className="text-muted-foreground">—</span>
                  ) : rule.pipeline ? (
                    <Badge variant="outline">{rule.pipeline.name}</Badge>
                  ) : (
                    <span className="text-muted-foreground">All</span>
                  )}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={rule.enabled}
                    disabled={toggleMutation.isPending}
                    onCheckedChange={(checked) =>
                      toggleMutation.mutate({ id: rule.id, enabled: checked })
                    }
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Edit alert rule"
                      onClick={() => openEdit(rule)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      aria-label="Delete alert rule"
                      onClick={() =>
                        setDeleteTarget({ id: rule.id, name: rule.name })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingRuleId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingRuleId ? "Edit Alert Rule" : "Create Alert Rule"}
            </DialogTitle>
            <DialogDescription>
              {editingRuleId
                ? "Update the alert rule configuration."
                : "Define a new alert rule for this environment."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                placeholder="High CPU usage"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>

            {!editingRuleId && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rule-metric">Metric</Label>
                  <Select
                    value={form.metric}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        metric: v,
                        condition: BINARY_METRICS.has(v) ? "eq" : isEventMetric(v) ? "" : "gt",
                        ...(BINARY_METRICS.has(v)
                          ? { threshold: "1" }
                          : isEventMetric(v)
                            ? { threshold: "", durationSeconds: "" }
                            : {}),
                        ...(GLOBAL_METRICS.has(v) ? { pipelineId: "" } : {}),
                      }))
                    }
                  >
                    <SelectTrigger id="rule-metric">
                      <SelectValue placeholder="Select metric" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Infrastructure</SelectLabel>
                        <SelectItem value="cpu_usage">CPU Usage</SelectItem>
                        <SelectItem value="memory_usage">Memory Usage</SelectItem>
                        <SelectItem value="disk_usage">Disk Usage</SelectItem>
                        <SelectItem value="error_rate">Error Rate</SelectItem>
                        <SelectItem value="discarded_rate">Discarded Rate</SelectItem>
                        <SelectItem value="node_unreachable">Node Unreachable</SelectItem>
                        <SelectItem value="pipeline_crashed">Pipeline Crashed</SelectItem>
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Events</SelectLabel>
                        <SelectItem value="deploy_requested">Deploy Requested</SelectItem>
                        <SelectItem value="deploy_completed">Deploy Completed</SelectItem>
                        <SelectItem value="deploy_rejected">Deploy Rejected</SelectItem>
                        <SelectItem value="deploy_cancelled">Deploy Cancelled</SelectItem>
                        <SelectItem value="new_version_available">New Version Available</SelectItem>
                        <SelectItem value="scim_sync_failed">SCIM Sync Failed</SelectItem>
                        <SelectItem value="backup_failed">Backup Failed</SelectItem>
                        <SelectItem value="certificate_expiring">Certificate Expiring</SelectItem>
                        <SelectItem value="node_joined">Node Joined</SelectItem>
                        <SelectItem value="node_left">Node Left</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                {!GLOBAL_METRICS.has(form.metric) && (
                  <div className="space-y-2">
                    <Label htmlFor="rule-pipeline">Pipeline (optional)</Label>
                    <Select
                      value={form.pipelineId}
                      onValueChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          pipelineId: v === "__none__" ? "" : v,
                        }))
                      }
                    >
                      <SelectTrigger id="rule-pipeline">
                        <SelectValue placeholder="All pipelines" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">All pipelines</SelectItem>
                        {pipelines.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            {isEventMetric(form.metric) || BINARY_METRICS.has(form.metric) ? (
              <p className="text-sm text-muted-foreground py-2">
                Notifications will be sent when this event occurs.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rule-threshold">Threshold</Label>
                  <Input
                    id="rule-threshold"
                    type="number"
                    placeholder="80"
                    value={form.threshold}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, threshold: e.target.value }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rule-duration">Duration (seconds)</Label>
                  <Input
                    id="rule-duration"
                    type="number"
                    placeholder="60"
                    value={form.durationSeconds}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, durationSeconds: e.target.value }))
                    }
                  />
                </div>
              </>
            )}

            {channels.length > 0 && (
              <div className="space-y-2">
                <Label>Notification Channels (optional)</Label>
                <p className="text-xs text-muted-foreground">
                  Select channels for this rule. If none are selected, all
                  enabled channels will be used.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {channels.map((ch) => {
                    const selected = form.channelIds.includes(ch.id);
                    return (
                      <Badge
                        key={ch.id}
                        variant={selected ? "default" : "outline"}
                        className="cursor-pointer select-none"
                        onClick={() => toggleChannel(ch.id)}
                      >
                        {CHANNEL_TYPE_LABELS[ch.type] ?? ch.type}: {ch.name}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : editingRuleId ? (
                "Update Rule"
              ) : (
                "Create Rule"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Alert Rule"
        description={
          <>
            Are you sure you want to delete{" "}
            <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </>
        }
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
        }}
      />
    </div>
  );
}
