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

const CONDITION_LABELS_LONG: Record<string, string> = {
  gt: "Greater than (>)",
  lt: "Less than (<)",
  eq: "Equal to (=)",
};

// ─── Alert Rules Section ────────────────────────────────────────────────────────

interface RuleFormState {
  name: string;
  pipelineId: string;
  metric: string;
  condition: string;
  threshold: string;
  durationSeconds: string;
}

const EMPTY_RULE_FORM: RuleFormState = {
  name: "",
  pipelineId: "",
  metric: "",
  condition: "",
  threshold: "",
  durationSeconds: "60",
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
    });
    setDialogOpen(true);
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
      });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Alert Rules</h3>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Rule
        </Button>
      </div>

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
                      onClick={() => openEdit(rule)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
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

// ─── Webhooks Section ───────────────────────────────────────────────────────────

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Webhook className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Webhooks</h3>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Webhook
        </Button>
      </div>

      {webhooksQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No webhooks configured</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Add a webhook to receive alert notifications via HTTP.
          </p>
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
                      onClick={() => openEdit(webhook)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
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
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Alerts</h2>
          <p className="text-muted-foreground">
            Manage alert rules, webhooks, and view alert history
          </p>
        </div>
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
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Alerts</h2>
        <p className="text-muted-foreground">
          Manage alert rules, webhooks, and view alert history
        </p>
      </div>

      <AlertRulesSection environmentId={selectedEnvironmentId} />

      <Separator />

      <WebhooksSection environmentId={selectedEnvironmentId} />

      <Separator />

      <AlertHistorySection environmentId={selectedEnvironmentId} />
    </div>
  );
}
