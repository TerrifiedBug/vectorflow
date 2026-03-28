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
  Clock,
  AlarmClockOff,
} from "lucide-react";
import type { AlertMetric, AlertCondition } from "@/generated/prisma";

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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { isEventMetric, isFleetMetric } from "@/lib/alert-metrics";

import {
  METRIC_LABELS,
  CONDITION_LABELS,
  BINARY_METRICS,
  GLOBAL_METRICS,
  CHANNEL_TYPE_LABELS,
} from "./constants";
import { AlertTemplatePicker } from "./alert-template-picker";

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

const SNOOZE_PRESETS = [
  { label: "15 minutes", minutes: 15 },
  { label: "1 hour", minutes: 60 },
  { label: "4 hours", minutes: 240 },
  { label: "24 hours", minutes: 1440 },
] as const;

function snoozedMinutesLeft(snoozedUntil: Date | string | null | undefined): number | null {
  if (!snoozedUntil) return null;
  const diff = new Date(snoozedUntil).getTime() - Date.now();
  if (diff <= 0) return null;
  return Math.round(diff / 60000);
}

function formatSnoozeRemaining(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  }
  return `${minutes}m left`;
}

export function AlertRulesSection({ environmentId }: { environmentId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_RULE_FORM);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const markTouched = (field: string) =>
    setTouched((t) => ({ ...t, [field]: true }));

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
        toast.error(error.message || "Failed to create alert rule", { duration: 6000 });
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
        toast.error(error.message || "Failed to update alert rule", { duration: 6000 });
      },
    }),
  );

  const toggleMutation = useMutation(
    trpc.alert.updateRule.mutationOptions({
      onSuccess: () => {
        invalidateRules();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to toggle alert rule", { duration: 6000 });
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
        toast.error(error.message || "Failed to delete alert rule", { duration: 6000 });
      },
    }),
  );

  const snoozeMutation = useMutation(
    trpc.alert.snoozeRule.mutationOptions({
      onSuccess: (_data, variables) => {
        const label = SNOOZE_PRESETS.find((p) => p.minutes === variables.duration)?.label ?? `${variables.duration}m`;
        toast.success(`Rule snoozed for ${label}`);
        invalidateRules();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to snooze alert rule", { duration: 6000 });
      },
    }),
  );

  const unsnoozeMutation = useMutation(
    trpc.alert.unsnoozeRule.mutationOptions({
      onSuccess: () => {
        toast.success("Rule unsnoozed");
        invalidateRules();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to unsnooze alert rule", { duration: 6000 });
      },
    }),
  );

  const rules = rulesQuery.data ?? [];
  const pipelines = pipelinesQuery.data?.pipelines ?? [];
  const channels = channelsQuery.data ?? [];

  const openCreate = () => {
    setEditingRuleId(null);
    setForm(EMPTY_RULE_FORM);
    setTouched({});
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
    setTouched({});
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

  const isBinaryOrEvent = BINARY_METRICS.has(form.metric) || isEventMetric(form.metric);
  const formErrors = {
    name: !form.name.trim() ? "Name is required." : null,
    metric: !form.metric ? "Select a metric." : null,
    threshold: !isBinaryOrEvent && !form.threshold ? "Enter a numeric threshold value." : null,
  };
  const isFormValid = !formErrors.name && !formErrors.metric && !formErrors.threshold;

  const handleSubmit = () => {
    setTouched({ name: true, metric: true, threshold: true });
    const isBinary = BINARY_METRICS.has(form.metric);
    const isEvent = isEventMetric(form.metric);
    if (!form.name || !form.metric || (!isBinary && !isEvent && !form.threshold)) {
      toast.error("Please fill in all required fields", { duration: 6000 });
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
          <StaggerList as="tbody" className="[&_tr:last-child]:border-0">
            {rules.map((rule) => (
              <StaggerItem as="tr" key={rule.id} className="hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors">
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {rule.name}
                    {(() => {
                      const mins = snoozedMinutesLeft(rule.snoozedUntil);
                      if (mins == null) return null;
                      return (
                        <Badge variant="secondary" className="text-xs whitespace-nowrap">
                          Snoozed · {formatSnoozeRemaining(mins)}
                        </Badge>
                      );
                    })()}
                  </div>
                </TableCell>
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
                  {isFleetMetric(rule.metric) ? (
                    <Badge variant="secondary">Fleet</Badge>
                  ) : GLOBAL_METRICS.has(rule.metric) ? (
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
                    {snoozedMinutesLeft(rule.snoozedUntil) != null ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Unsnooze alert rule"
                        disabled={unsnoozeMutation.isPending}
                        onClick={() => unsnoozeMutation.mutate({ id: rule.id })}
                      >
                        <AlarmClockOff className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Snooze alert rule"
                          >
                            <Clock className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-40 p-2" align="end">
                          <div className="flex flex-col gap-1">
                            <p className="text-xs font-medium text-muted-foreground px-2 pb-1">
                              Snooze for
                            </p>
                            {SNOOZE_PRESETS.map((preset) => (
                              <Button
                                key={preset.minutes}
                                variant="ghost"
                                size="sm"
                                className="justify-start"
                                disabled={snoozeMutation.isPending}
                                onClick={() =>
                                  snoozeMutation.mutate({
                                    id: rule.id,
                                    duration: preset.minutes,
                                  })
                                }
                              >
                                {preset.label}
                              </Button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
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
              </StaggerItem>
            ))}
          </StaggerList>
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

          {!editingRuleId && (
            <AlertTemplatePicker
              onSelect={(values) =>
                setForm((f) => ({
                  ...f,
                  name: values.name,
                  metric: values.metric,
                  condition: values.condition,
                  threshold: values.threshold,
                  durationSeconds: values.durationSeconds,
                }))
              }
            />
          )}

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="rule-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rule-name"
                placeholder="High CPU usage"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                onBlur={() => markTouched("name")}
              />
              {touched.name && formErrors.name && (
                <p className="text-xs text-destructive mt-1">{formErrors.name}</p>
              )}
            </div>

            {!editingRuleId && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rule-metric">
                    Metric <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.metric}
                    onValueChange={(v) => {
                      markTouched("metric");
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
                      }));
                    }}
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
                      <SelectGroup>
                        <SelectLabel>Fleet</SelectLabel>
                        <SelectItem value="fleet_error_rate">Fleet Error Rate</SelectItem>
                        <SelectItem value="fleet_throughput_drop">Fleet Throughput Drop</SelectItem>
                        <SelectItem value="fleet_event_volume">Fleet Event Volume</SelectItem>
                        <SelectItem value="node_load_imbalance">Node Load Imbalance</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {touched.metric && formErrors.metric && (
                    <p className="text-xs text-destructive mt-1">{formErrors.metric}</p>
                  )}
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
                  <Label htmlFor="rule-threshold">
                    Threshold <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="rule-threshold"
                    type="number"
                    placeholder="80"
                    value={form.threshold}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, threshold: e.target.value }))
                    }
                    onBlur={() => markTouched("threshold")}
                  />
                  {touched.threshold && formErrors.threshold && (
                    <p className="text-xs text-destructive mt-1">{formErrors.threshold}</p>
                  )}
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
            <Button onClick={handleSubmit} disabled={isSaving || !isFormValid}>
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
