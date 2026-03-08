"use client";

import { useState, useCallback } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Send,
  Bell,
  Webhook,
  History,
  BellRing,
  Mail,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";
import { AlertMetric, AlertCondition } from "@/generated/prisma";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";

// ─── Constants ──────────────────────────────────────────────────────────────────

const METRIC_LABELS: Record<string, string> = {
  node_unreachable: "Node Unreachable",
  cpu_usage: "CPU Usage",
  memory_usage: "Memory Usage",
  disk_usage: "Disk Usage",
  error_rate: "Error Rate",
  discarded_rate: "Discarded Rate",
  pipeline_crashed: "Pipeline Crashed",
};

const CONDITION_LABELS: Record<string, string> = {
  gt: ">",
  lt: "<",
  eq: "=",
};

const BINARY_METRICS = new Set(["node_unreachable", "pipeline_crashed"]);

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  slack: "Slack",
  email: "Email",
  pagerduty: "PagerDuty",
  webhook: "Webhook",
};

const CHANNEL_TYPE_ICONS: Record<string, typeof MessageSquare> = {
  slack: MessageSquare,
  email: Mail,
  pagerduty: AlertTriangle,
  webhook: Webhook,
};

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

function AlertRulesSection({ environmentId }: { environmentId: string }) {
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
    setForm({
      name: rule.name,
      pipelineId: rule.pipelineId ?? "",
      metric: rule.metric,
      condition: rule.condition,
      threshold: String(rule.threshold),
      durationSeconds: String(rule.durationSeconds),
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
    if (!form.name || !form.metric || (!isBinary && !form.threshold)) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (editingRuleId) {
      updateMutation.mutate({
        id: editingRuleId,
        name: form.name,
        threshold: parseFloat(form.threshold),
        durationSeconds: parseInt(form.durationSeconds, 10) || 60,
        channelIds: form.channelIds,
      });
    } else {
      createMutation.mutate({
        name: form.name,
        environmentId,
        pipelineId: form.pipelineId || undefined,
        metric: form.metric as AlertMetric,
        condition: form.condition as AlertCondition,
        threshold: parseFloat(form.threshold),
        durationSeconds: parseInt(form.durationSeconds, 10) || 60,
        teamId: selectedTeamId!,
        channelIds: form.channelIds.length > 0 ? form.channelIds : undefined,
      });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Alerts"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Add Rule
          </Button>
        }
      />

      {rulesQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No alert rules configured</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Create an alert rule to monitor metrics and receive notifications.
          </p>
        </div>
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
                  {CONDITION_LABELS[rule.condition] ?? rule.condition}
                </TableCell>
                <TableCell className="font-mono">{rule.threshold}</TableCell>
                <TableCell className="text-muted-foreground">
                  {rule.durationSeconds}s
                </TableCell>
                <TableCell>
                  {rule.pipeline ? (
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

                <div className="space-y-2">
                  <Label htmlFor="rule-metric">Metric</Label>
                  <Select
                    value={form.metric}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        metric: v,
                        condition: BINARY_METRICS.has(v) ? "eq" : "gt",
                        ...(BINARY_METRICS.has(v)
                          ? { threshold: "1" }
                          : {}),
                      }))
                    }
                  >
                    <SelectTrigger id="rule-metric">
                      <SelectValue placeholder="Select metric" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(AlertMetric).map((m) => (
                        <SelectItem key={m} value={m}>
                          {METRIC_LABELS[m] ?? m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

              </>
            )}

            {!BINARY_METRICS.has(form.metric) && (
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
            )}

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

// ─── Notification Channels Section ───────────────────────────────────────────────

type ChannelType = "slack" | "email" | "pagerduty" | "webhook";

interface ChannelFormState {
  name: string;
  type: ChannelType;
  // Slack
  webhookUrl: string;
  // Email
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  emailFrom: string;
  recipients: string;
  // PagerDuty
  integrationKey: string;
  // Webhook
  url: string;
  headers: string;
  hmacSecret: string;
}

const EMPTY_CHANNEL_FORM: ChannelFormState = {
  name: "",
  type: "slack",
  webhookUrl: "",
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPass: "",
  emailFrom: "",
  recipients: "",
  integrationKey: "",
  url: "",
  headers: "",
  hmacSecret: "",
};

function buildConfigFromForm(form: ChannelFormState): Record<string, unknown> {
  switch (form.type) {
    case "slack":
      return { webhookUrl: form.webhookUrl };
    case "email":
      return {
        smtpHost: form.smtpHost,
        smtpPort: parseInt(form.smtpPort, 10) || 587,
        smtpUser: form.smtpUser || undefined,
        smtpPass: form.smtpPass || undefined,
        from: form.emailFrom,
        recipients: form.recipients
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
      };
    case "pagerduty":
      return { integrationKey: form.integrationKey };
    case "webhook": {
      const config: Record<string, unknown> = { url: form.url };
      if (form.headers.trim()) {
        try {
          config.headers = JSON.parse(form.headers);
        } catch {
          // Will be caught by validation
        }
      }
      if (form.hmacSecret) config.hmacSecret = form.hmacSecret;
      return config;
    }
  }
}

function formFromConfig(
  type: string,
  name: string,
  config: Record<string, unknown>,
): ChannelFormState {
  const base = { ...EMPTY_CHANNEL_FORM, name, type: type as ChannelType };

  switch (type) {
    case "slack":
      return { ...base, webhookUrl: (config.webhookUrl as string) ?? "" };
    case "email":
      return {
        ...base,
        smtpHost: (config.smtpHost as string) ?? "",
        smtpPort: String(config.smtpPort ?? 587),
        smtpUser: (config.smtpUser as string) ?? "",
        smtpPass: "",
        emailFrom: (config.from as string) ?? "",
        recipients: Array.isArray(config.recipients)
          ? (config.recipients as string[]).join(", ")
          : "",
      };
    case "pagerduty":
      return { ...base, integrationKey: "" };
    case "webhook":
      return {
        ...base,
        url: (config.url as string) ?? "",
        headers: config.headers
          ? JSON.stringify(config.headers, null, 2)
          : "",
        hmacSecret: "",
      };
    default:
      return base;
  }
}

function NotificationChannelsSection({
  environmentId,
}: {
  environmentId: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [form, setForm] = useState<ChannelFormState>(EMPTY_CHANNEL_FORM);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const channelsQuery = useQuery(
    trpc.alert.listChannels.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );

  const invalidateChannels = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: trpc.alert.listChannels.queryKey({ environmentId }),
    });
  }, [queryClient, trpc, environmentId]);

  const createMutation = useMutation(
    trpc.alert.createChannel.mutationOptions({
      onSuccess: () => {
        toast.success("Notification channel created");
        invalidateChannels();
        setDialogOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create channel");
      },
    }),
  );

  const updateMutation = useMutation(
    trpc.alert.updateChannel.mutationOptions({
      onSuccess: () => {
        toast.success("Notification channel updated");
        invalidateChannels();
        setDialogOpen(false);
        setEditingChannelId(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update channel");
      },
    }),
  );

  const toggleMutation = useMutation(
    trpc.alert.updateChannel.mutationOptions({
      onSuccess: () => {
        invalidateChannels();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to toggle channel");
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.alert.deleteChannel.mutationOptions({
      onSuccess: () => {
        toast.success("Notification channel deleted");
        invalidateChannels();
        setDeleteTarget(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete channel");
      },
    }),
  );

  const testMutation = useMutation(
    trpc.alert.testChannel.mutationOptions({
      onSuccess: (result) => {
        if (result.success) {
          toast.success("Channel test successful");
        } else {
          toast.error(`Channel test failed: ${result.error ?? "Unknown error"}`);
        }
      },
      onError: (error) => {
        toast.error(error.message || "Failed to test channel");
      },
    }),
  );

  const channels = channelsQuery.data ?? [];

  const openCreate = () => {
    setEditingChannelId(null);
    setForm(EMPTY_CHANNEL_FORM);
    setDialogOpen(true);
  };

  const openEdit = (channel: (typeof channels)[0]) => {
    setEditingChannelId(channel.id);
    setForm(
      formFromConfig(
        channel.type,
        channel.name,
        channel.config as Record<string, unknown>,
      ),
    );
    setDialogOpen(true);
  };

  const validateForm = (): boolean => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return false;
    }

    switch (form.type) {
      case "slack":
        if (!form.webhookUrl.trim()) {
          toast.error("Webhook URL is required");
          return false;
        }
        break;
      case "email":
        if (!form.smtpHost.trim() || !form.emailFrom.trim() || !form.recipients.trim()) {
          toast.error("SMTP host, from address, and recipients are required");
          return false;
        }
        break;
      case "pagerduty":
        if (!editingChannelId && !form.integrationKey.trim()) {
          toast.error("Integration key is required");
          return false;
        }
        break;
      case "webhook":
        if (!form.url.trim()) {
          toast.error("URL is required");
          return false;
        }
        if (form.headers.trim()) {
          try {
            const parsed = JSON.parse(form.headers);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              toast.error("Headers must be a JSON object");
              return false;
            }
          } catch {
            toast.error("Invalid JSON in headers field");
            return false;
          }
        }
        break;
    }

    return true;
  };

  const handleSubmit = () => {
    if (!validateForm()) return;

    const config = buildConfigFromForm(form);

    if (editingChannelId) {
      updateMutation.mutate({
        id: editingChannelId,
        name: form.name,
        config,
      });
    } else {
      createMutation.mutate({
        environmentId,
        name: form.name,
        type: form.type,
        config,
      });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Notification Channels</h3>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Channel
        </Button>
      </div>

      {channelsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No notification channels configured</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Add a notification channel to receive alerts via Slack, Email,
            PagerDuty, or Webhook.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="w-[160px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.map((channel) => {
              const Icon =
                CHANNEL_TYPE_ICONS[channel.type] ?? Webhook;
              return (
                <TableRow key={channel.id}>
                  <TableCell className="font-medium">{channel.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="gap-1">
                      <Icon className="h-3 w-3" />
                      {CHANNEL_TYPE_LABELS[channel.type] ?? channel.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={channel.enabled}
                      disabled={toggleMutation.isPending}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({
                          id: channel.id,
                          enabled: checked,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Test channel"
                        onClick={() =>
                          testMutation.mutate({ id: channel.id })
                        }
                        disabled={testMutation.isPending}
                      >
                        {testMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Edit channel"
                        onClick={() => openEdit(channel)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        aria-label="Delete channel"
                        onClick={() =>
                          setDeleteTarget({
                            id: channel.id,
                            name: channel.name,
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingChannelId(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingChannelId
                ? "Edit Notification Channel"
                : "Add Notification Channel"}
            </DialogTitle>
            <DialogDescription>
              {editingChannelId
                ? "Update the channel configuration."
                : "Configure a new notification channel for alert delivery."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="channel-name">Name</Label>
              <Input
                id="channel-name"
                placeholder="e.g., #ops-alerts"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>

            {!editingChannelId && (
              <div className="space-y-2">
                <Label htmlFor="channel-type">Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...EMPTY_CHANNEL_FORM,
                      name: f.name,
                      type: v as ChannelType,
                    }))
                  }
                >
                  <SelectTrigger id="channel-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="slack">Slack</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="pagerduty">PagerDuty</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Type-specific config forms */}
            {form.type === "slack" && (
              <div className="space-y-2">
                <Label htmlFor="slack-webhook-url">Webhook URL</Label>
                <Input
                  id="slack-webhook-url"
                  type="url"
                  placeholder="https://hooks.slack.com/services/..."
                  value={form.webhookUrl}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, webhookUrl: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Create an Incoming Webhook in your Slack workspace settings.
                </p>
              </div>
            )}

            {form.type === "email" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-host">SMTP Host</Label>
                    <Input
                      id="smtp-host"
                      placeholder="smtp.example.com"
                      value={form.smtpHost}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, smtpHost: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-port">SMTP Port</Label>
                    <Input
                      id="smtp-port"
                      type="number"
                      placeholder="587"
                      value={form.smtpPort}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, smtpPort: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-user">SMTP User (optional)</Label>
                    <Input
                      id="smtp-user"
                      placeholder="user@example.com"
                      value={form.smtpUser}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, smtpUser: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-pass">SMTP Password (optional)</Label>
                    <Input
                      id="smtp-pass"
                      type="password"
                      placeholder="Enter password"
                      value={form.smtpPass}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, smtpPass: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-from">From Address</Label>
                  <Input
                    id="email-from"
                    type="email"
                    placeholder="alerts@example.com"
                    value={form.emailFrom}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, emailFrom: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-recipients">Recipients</Label>
                  <Input
                    id="email-recipients"
                    placeholder="alice@example.com, bob@example.com"
                    value={form.recipients}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, recipients: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated list of email addresses.
                  </p>
                </div>
              </>
            )}

            {form.type === "pagerduty" && (
              <div className="space-y-2">
                <Label htmlFor="pd-integration-key">Integration Key</Label>
                <Input
                  id="pd-integration-key"
                  type="password"
                  placeholder={
                    editingChannelId
                      ? "Leave blank to keep existing key"
                      : "Enter PagerDuty integration key"
                  }
                  value={form.integrationKey}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      integrationKey: e.target.value,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {editingChannelId
                    ? "Leave blank to keep the existing key, or enter a new one to replace it."
                    : "Found in PagerDuty under Service > Integrations > Events API v2."}
                </p>
              </div>
            )}

            {form.type === "webhook" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="wh-url">URL</Label>
                  <Input
                    id="wh-url"
                    type="url"
                    placeholder="https://example.com/webhook"
                    value={form.url}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, url: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wh-headers">
                    Headers (optional JSON object)
                  </Label>
                  <Textarea
                    id="wh-headers"
                    placeholder={'{\n  "Authorization": "Bearer token"\n}'}
                    rows={4}
                    value={form.headers}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, headers: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wh-hmac">HMAC Secret (optional)</Label>
                  <Input
                    id="wh-hmac"
                    type="password"
                    placeholder="Enter HMAC secret"
                    value={form.hmacSecret}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, hmacSecret: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    If set, payloads will include an X-VectorFlow-Signature
                    header.
                  </p>
                </div>
              </>
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
              ) : editingChannelId ? (
                "Update Channel"
              ) : (
                "Add Channel"
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
        title="Delete Notification Channel"
        description={
          <>
            Are you sure you want to delete{" "}
            <strong>{deleteTarget?.name}</strong>? This action cannot be
            undone.
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

// ─── Legacy Webhooks Section (preserved for backward compatibility) ──────────

interface WebhookFormState {
  url: string;
  headers: string;
  hmacSecret: string;
}

const EMPTY_WEBHOOK_FORM: WebhookFormState = {
  url: "",
  headers: "",
  hmacSecret: "",
};

function WebhooksSection({ environmentId }: { environmentId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);
  const [form, setForm] = useState<WebhookFormState>(EMPTY_WEBHOOK_FORM);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    url: string;
  } | null>(null);

  const webhooksQuery = useQuery(
    trpc.alert.listWebhooks.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );

  const invalidateWebhooks = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: trpc.alert.listWebhooks.queryKey({ environmentId }),
    });
  }, [queryClient, trpc, environmentId]);

  const createMutation = useMutation(
    trpc.alert.createWebhook.mutationOptions({
      onSuccess: () => {
        toast.success("Webhook created");
        invalidateWebhooks();
        setDialogOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create webhook");
      },
    }),
  );

  const updateMutation = useMutation(
    trpc.alert.updateWebhook.mutationOptions({
      onSuccess: () => {
        toast.success("Webhook updated");
        invalidateWebhooks();
        setDialogOpen(false);
        setEditingWebhookId(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update webhook");
      },
    }),
  );

  const toggleMutation = useMutation(
    trpc.alert.updateWebhook.mutationOptions({
      onSuccess: () => {
        invalidateWebhooks();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to toggle webhook");
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.alert.deleteWebhook.mutationOptions({
      onSuccess: () => {
        toast.success("Webhook deleted");
        invalidateWebhooks();
        setDeleteTarget(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete webhook");
      },
    }),
  );

  const testMutation = useMutation(
    trpc.alert.testWebhook.mutationOptions({
      onSuccess: (result) => {
        if (result.success) {
          toast.success(
            `Webhook test successful (${result.statusCode} ${result.statusText})`,
          );
        } else {
          toast.error(
            `Webhook test failed: ${result.statusCode} ${result.statusText}`,
          );
        }
      },
      onError: (error) => {
        toast.error(error.message || "Failed to test webhook");
      },
    }),
  );

  const webhooks = webhooksQuery.data ?? [];

  const openCreate = () => {
    setEditingWebhookId(null);
    setForm(EMPTY_WEBHOOK_FORM);
    setDialogOpen(true);
  };

  const openEdit = (webhook: (typeof webhooks)[0]) => {
    setEditingWebhookId(webhook.id);
    const headersStr = webhook.headers
      ? JSON.stringify(webhook.headers, null, 2)
      : "";
    setForm({
      url: webhook.url,
      headers: headersStr,
      hmacSecret: "",
    });
    setDialogOpen(true);
  };

  const parseHeaders = (
    raw: string,
  ): Record<string, string> | undefined => {
    if (!raw.trim()) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        toast.error("Headers must be a JSON object");
        return undefined;
      }
      return parsed as Record<string, string>;
    } catch {
      toast.error("Invalid JSON in headers field");
      return undefined;
    }
  };

  const handleSubmit = () => {
    if (!form.url) {
      toast.error("URL is required");
      return;
    }

    let headers: Record<string, string> | undefined | null;
    if (form.headers.trim()) {
      headers = parseHeaders(form.headers);
      if (headers === undefined) return; // parse error already shown
    } else {
      headers = editingWebhookId ? null : undefined;
    }

    if (editingWebhookId) {
      updateMutation.mutate({
        id: editingWebhookId,
        url: form.url,
        headers: headers,
        hmacSecret: form.hmacSecret || null,
      });
    } else {
      createMutation.mutate({
        environmentId,
        url: form.url,
        headers: headers ?? undefined,
        hmacSecret: form.hmacSecret || undefined,
      });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // If no legacy webhooks exist, don't show this section
  if (!webhooksQuery.isLoading && webhooks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Webhook className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Legacy Webhooks</h3>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Webhook
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Legacy webhooks are kept for backward compatibility. Consider migrating
        to Notification Channels above for a unified experience.
      </p>

      {webhooksQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="w-[160px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks.map((webhook) => (
              <TableRow key={webhook.id}>
                <TableCell className="font-mono text-sm max-w-[400px] truncate">
                  {webhook.url}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={webhook.enabled}
                    disabled={toggleMutation.isPending}
                    onCheckedChange={(checked) =>
                      toggleMutation.mutate({
                        id: webhook.id,
                        enabled: checked,
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => testMutation.mutate({ id: webhook.id })}
                      disabled={testMutation.isPending}
                    >
                      {testMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Edit webhook"
                      onClick={() => openEdit(webhook)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      aria-label="Delete webhook"
                      onClick={() =>
                        setDeleteTarget({
                          id: webhook.id,
                          url: webhook.url,
                        })
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
          if (!open) setEditingWebhookId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingWebhookId ? "Edit Webhook" : "Add Webhook"}
            </DialogTitle>
            <DialogDescription>
              {editingWebhookId
                ? "Update the webhook configuration."
                : "Configure a new webhook endpoint for alert delivery."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">URL</Label>
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://example.com/webhook"
                value={form.url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, url: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook-headers">
                Headers (optional JSON object)
              </Label>
              <Textarea
                id="webhook-headers"
                placeholder={'{\n  "Authorization": "Bearer token"\n}'}
                rows={4}
                value={form.headers}
                onChange={(e) =>
                  setForm((f) => ({ ...f, headers: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook-hmac">HMAC Secret (optional)</Label>
              <Input
                id="webhook-hmac"
                type="password"
                placeholder="Enter HMAC secret"
                value={form.hmacSecret}
                onChange={(e) =>
                  setForm((f) => ({ ...f, hmacSecret: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                If set, payloads will include an X-VectorFlow-Signature header.
              </p>
            </div>
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
              ) : editingWebhookId ? (
                "Update Webhook"
              ) : (
                "Add Webhook"
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
        title="Delete Webhook"
        description={
          <>
            Are you sure you want to delete the webhook for{" "}
            <strong className="break-all">{deleteTarget?.url}</strong>? This
            action cannot be undone.
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

// ─── Alert History Section ──────────────────────────────────────────────────────

function AlertHistorySection({ environmentId }: { environmentId: string }) {
  const trpc = useTRPC();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allItems, setAllItems] = useState<
    Array<{
      id: string;
      status: string;
      value: number;
      message: string | null;
      firedAt: Date;
      resolvedAt: Date | null;
      node: { id: string; host: string } | null;
      alertRule: {
        id: string;
        name: string;
        metric: string;
        condition: string;
        threshold: number;
        pipeline: { id: string; name: string } | null;
      };
    }>
  >([]);

  const eventsQuery = useQuery(
    trpc.alert.listEvents.queryOptions(
      { environmentId, limit: 50, cursor },
      { enabled: !!environmentId },
    ),
  );

  // Merge newly fetched items when data changes
  const items = eventsQuery.data?.items ?? [];
  const nextCursor = eventsQuery.data?.nextCursor;

  // Build display list: first page directly from query, subsequent pages accumulated
  const displayItems = cursor ? allItems : items;

  const loadMore = () => {
    if (nextCursor) {
      setAllItems((prev) => {
        // Combine previous items with current items, dedup by id
        const existing = new Set(prev.map((i) => i.id));
        const newItems = items.filter((i) => !existing.has(i.id));
        return [...prev, ...newItems];
      });
      setCursor(nextCursor);
    }
  };

  const formatTimestamp = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleString();
  };

  const isLoading = eventsQuery.isLoading;
  const isFetchingMore = eventsQuery.isFetching && !!cursor;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Alert History</h3>
      </div>

      {isLoading && !cursor ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : displayItems.length === 0 && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No alert events yet</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Alert events will appear here when rules are triggered.
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Rule Name</TableHead>
                <TableHead>Node</TableHead>
                <TableHead>Pipeline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(cursor ? displayItems : items).map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {formatTimestamp(event.firedAt)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {event.alertRule.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.node?.host ?? "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.alertRule.pipeline?.name ?? "-"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      variant={
                        event.status === "firing" ? "error" : "healthy"
                      }
                    >
                      {event.status === "firing" ? "Firing" : "Resolved"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="font-mono">
                    {typeof event.value === "number"
                      ? event.value.toFixed(2)
                      : event.value}
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate text-muted-foreground">
                    {event.message || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={isFetchingMore}
              >
                {isFetchingMore ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Alerts Page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );

  if (!selectedEnvironmentId) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            Select an environment to manage alerts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AlertRulesSection environmentId={selectedEnvironmentId} />

      <Separator />

      <NotificationChannelsSection environmentId={selectedEnvironmentId} />

      <WebhooksSection environmentId={selectedEnvironmentId} />

      <Separator />

      <AlertHistorySection environmentId={selectedEnvironmentId} />
    </div>
  );
}
