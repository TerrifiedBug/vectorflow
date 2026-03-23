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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { ConfirmDialog } from "@/components/confirm-dialog";

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

export function WebhooksSection({ environmentId }: { environmentId: string }) {
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
