"use client";

import { useState, useCallback } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Send,
  Webhook,
  BellRing,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";

import {
  CHANNEL_TYPE_LABELS,
  CHANNEL_TYPE_ICONS,
} from "./constants";

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

export function NotificationChannelsSection({
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
        toast.error(error.message || "Failed to create channel", { duration: 6000 });
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
        toast.error(error.message || "Failed to update channel", { duration: 6000 });
      },
    }),
  );

  const toggleMutation = useMutation(
    trpc.alert.updateChannel.mutationOptions({
      onSuccess: () => {
        invalidateChannels();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to toggle channel", { duration: 6000 });
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
        toast.error(error.message || "Failed to delete channel", { duration: 6000 });
      },
    }),
  );

  const testMutation = useMutation(
    trpc.alert.testChannel.mutationOptions({
      onSuccess: (result) => {
        if (result.success) {
          toast.success("Channel test successful");
        } else {
          toast.error(`Channel test failed: ${result.error ?? "Unknown error"}`, { duration: 6000 });
        }
      },
      onError: (error) => {
        toast.error(error.message || "Failed to test channel", { duration: 6000 });
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
      toast.error("Name is required", { duration: 6000 });
      return false;
    }

    switch (form.type) {
      case "slack":
        if (!form.webhookUrl.trim()) {
          toast.error("Webhook URL is required", { duration: 6000 });
          return false;
        }
        break;
      case "email":
        if (!form.smtpHost.trim() || !form.emailFrom.trim() || !form.recipients.trim()) {
          toast.error("SMTP host, from address, and recipients are required", { duration: 6000 });
          return false;
        }
        break;
      case "pagerduty":
        if (!editingChannelId && !form.integrationKey.trim()) {
          toast.error("Integration key is required", { duration: 6000 });
          return false;
        }
        break;
      case "webhook":
        if (!form.url.trim()) {
          toast.error("URL is required", { duration: 6000 });
          return false;
        }
        if (form.headers.trim()) {
          try {
            const parsed = JSON.parse(form.headers);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              toast.error("Headers must be a JSON object", { duration: 6000 });
              return false;
            }
          } catch {
            toast.error("Invalid JSON in headers field", { duration: 6000 });
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

      {channelsQuery.isError ? (
        <QueryError message="Failed to load notification channels" onRetry={() => channelsQuery.refetch()} />
      ) : channelsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <EmptyState title="No notification channels configured" description="Add a notification channel to receive alerts via Slack, Email, PagerDuty, or Webhook." />
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
        <DialogContent className="sm:max-w-lg">
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
