"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { copyToClipboard } from "@/lib/utils";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Copy,
  Trash2,
  Webhook,
  ShieldCheck,
  Clock,
  ChevronDown,
  ChevronRight,
  Play,
  CheckCircle,
  XCircle,
  AlertCircle,
  Pencil,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { AlertMetric } from "@/generated/prisma";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Supported webhook event types with human-readable labels.
 * Only the outbound-webhook-relevant subset of AlertMetric.
 */
const WEBHOOK_EVENT_TYPES: { value: AlertMetric; label: string; description: string }[] = [
  {
    value: "deploy_completed" as AlertMetric,
    label: "Deploy Completed",
    description: "A pipeline was successfully deployed",
  },
  {
    value: "pipeline_crashed" as AlertMetric,
    label: "Pipeline Crashed",
    description: "A running pipeline process exited unexpectedly",
  },
  {
    value: "node_unreachable" as AlertMetric,
    label: "Node Unreachable",
    description: "A fleet node stopped sending heartbeats",
  },
  {
    value: "node_joined" as AlertMetric,
    label: "Node Joined",
    description: "A new fleet node enrolled",
  },
  {
    value: "node_left" as AlertMetric,
    label: "Node Left",
    description: "A fleet node was removed",
  },
  {
    value: "deploy_rejected" as AlertMetric,
    label: "Deploy Rejected",
    description: "A deployment request was rejected",
  },
  {
    value: "deploy_cancelled" as AlertMetric,
    label: "Deploy Cancelled",
    description: "A pending deployment was cancelled",
  },
  {
    value: "promotion_completed" as AlertMetric,
    label: "Promotion Completed",
    description: "A pipeline was promoted to another environment",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function deliveryStatusBadge(status: string) {
  switch (status) {
    case "success":
      return (
        <Badge variant="default" className="bg-green-500 hover:bg-green-600 text-white gap-1">
          <CheckCircle className="h-3 w-3" />
          Success
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    case "dead_letter":
      return (
        <Badge variant="secondary" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          Dead Letter
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" />
          Pending
        </Badge>
      );
  }
}

// ─── Delivery History Row ─────────────────────────────────────────────────────

type DeliveryRecord = {
  id: string;
  eventType: AlertMetric;
  status: string;
  statusCode: number | null;
  attemptNumber: number;
  errorMessage: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  nextRetryAt: Date | null;
};

function DeliveryHistoryPanel({
  endpointId,
  teamId,
}: {
  endpointId: string;
  teamId: string;
}) {
  const trpc = useTRPC();
  const [skip, setSkip] = useState(0);
  const take = 10;

  const query = useQuery(
    trpc.webhookEndpoint.listDeliveries.queryOptions(
      { webhookEndpointId: endpointId, teamId, take, skip },
      { enabled: !!endpointId },
    ),
  );

  const deliveries = (query.data?.deliveries ?? []) as DeliveryRecord[];
  const total = query.data?.total ?? 0;

  if (query.isError) {
    return (
      <div className="text-sm text-destructive px-4 py-2">
        Failed to load delivery history.
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="px-4 py-3 space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (deliveries.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground text-center">
        No deliveries yet. Trigger a test delivery or wait for an event.
      </div>
    );
  }

  return (
    <div className="border-t">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>HTTP</TableHead>
            <TableHead>Attempt</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead>Completed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map((d) => {
            const eventLabel =
              WEBHOOK_EVENT_TYPES.find((e) => e.value === d.eventType)?.label ?? d.eventType;
            return (
              <TableRow key={d.id}>
                <TableCell className="text-sm">{eventLabel}</TableCell>
                <TableCell>{deliveryStatusBadge(d.status)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {d.statusCode ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  #{d.attemptNumber}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatRelativeTime(d.requestedAt)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {d.completedAt ? formatRelativeTime(d.completedAt) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {total > take && (
        <div className="flex items-center justify-between px-4 py-2 border-t">
          <span className="text-xs text-muted-foreground">
            {skip + 1}–{Math.min(skip + take, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSkip(Math.max(0, skip - take))}
              disabled={skip === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSkip(skip + take)}
              disabled={skip + take >= total}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Endpoint Row ─────────────────────────────────────────────────────────────

type Endpoint = {
  id: string;
  name: string;
  url: string;
  eventTypes: AlertMetric[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function EndpointRow({
  endpoint,
  teamId,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  testPending,
}: {
  endpoint: Endpoint;
  teamId: string;
  onEdit: (ep: Endpoint) => void;
  onDelete: (ep: Endpoint) => void;
  onToggle: (id: string) => void;
  onTest: (id: string) => void;
  testPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <TableRow>
        <TableCell>
          <div>
            <div className="font-medium">{endpoint.name}</div>
            <div className="text-xs text-muted-foreground truncate max-w-[280px]">
              {endpoint.url}
            </div>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1 max-w-[260px]">
            {endpoint.eventTypes.map((et) => {
              const label = WEBHOOK_EVENT_TYPES.find((e) => e.value === et)?.label ?? et;
              return (
                <Badge key={et} variant="outline" className="text-[10px] px-1.5 py-0">
                  {label}
                </Badge>
              );
            })}
          </div>
        </TableCell>
        <TableCell>
          <Badge variant={endpoint.enabled ? "default" : "secondary"}>
            {endpoint.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {formatRelativeTime(endpoint.createdAt)}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={expanded ? "Hide delivery history" : "Show delivery history"}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Send test delivery"
              onClick={() => onTest(endpoint.id)}
              disabled={testPending}
            >
              {testPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={endpoint.enabled ? "Disable" : "Enable"}
              onClick={() => onToggle(endpoint.id)}
            >
              {endpoint.enabled ? (
                <ToggleRight className="h-4 w-4 text-green-500" />
              ) : (
                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Edit"
              onClick={() => onEdit(endpoint)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              title="Delete"
              onClick={() => onDelete(endpoint)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={5} className="p-0 bg-muted/30">
            <div className="px-2 py-1">
              <div className="text-xs font-medium text-muted-foreground mb-1 px-2 pt-2">
                Delivery History
              </div>
              <DeliveryHistoryPanel endpointId={endpoint.id} teamId={teamId} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Create / Edit Dialog ─────────────────────────────────────────────────────

function EndpointDialog({
  open,
  onOpenChange,
  teamId,
  editTarget,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  editTarget: Endpoint | null;
  onSuccess: (secret: string | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const isEdit = !!editTarget;

  const [name, setName] = useState(editTarget?.name ?? "");
  const [url, setUrl] = useState(editTarget?.url ?? "");
  const [secret, setSecret] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(
    new Set(editTarget?.eventTypes ?? []),
  );

  // Reset when dialog opens/closes or editTarget changes
  function reset() {
    setName(editTarget?.name ?? "");
    setUrl(editTarget?.url ?? "");
    setSecret("");
    setSelectedEvents(new Set(editTarget?.eventTypes ?? []));
  }

  const createMutation = useMutation(
    trpc.webhookEndpoint.create.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: trpc.webhookEndpoint.list.queryKey(),
        });
        onOpenChange(false);
        onSuccess((data as { secret?: string | null }).secret ?? null);
        toast.success("Webhook endpoint created");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to create webhook endpoint", { duration: 6000 });
      },
    }),
  );

  const updateMutation = useMutation(
    trpc.webhookEndpoint.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.webhookEndpoint.list.queryKey(),
        });
        onOpenChange(false);
        toast.success("Webhook endpoint updated");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to update webhook endpoint", { duration: 6000 });
      },
    }),
  );

  function toggleEvent(value: string) {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function handleSubmit() {
    if (!name.trim() || !url.trim() || selectedEvents.size === 0) {
      toast.error("Name, URL, and at least one event type are required", { duration: 6000 });
      return;
    }
    const eventTypes = Array.from(selectedEvents) as AlertMetric[];
    if (isEdit && editTarget) {
      updateMutation.mutate({
        id: editTarget.id,
        teamId,
        name: name.trim(),
        url: url.trim(),
        eventTypes,
        secret: secret.trim() || undefined,
      });
    } else {
      createMutation.mutate({
        teamId,
        name: name.trim(),
        url: url.trim(),
        eventTypes,
        secret: secret.trim() || undefined,
      });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Webhook Endpoint" : "Create Webhook Endpoint"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the endpoint configuration. Leave the signing secret blank to keep the existing one."
              : "Webhook deliveries are HMAC-SHA256 signed. The signing secret is shown once — store it securely."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Name */}
          <div className="grid gap-2">
            <Label htmlFor="wh-name">Name *</Label>
            <Input
              id="wh-name"
              placeholder="e.g., Production Alerting"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* URL */}
          <div className="grid gap-2">
            <Label htmlFor="wh-url">Endpoint URL *</Label>
            <Input
              id="wh-url"
              placeholder="https://example.com/webhook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          {/* Secret */}
          <div className="grid gap-2">
            <Label htmlFor="wh-secret">
              Signing Secret {isEdit ? "(leave blank to keep current)" : "(optional)"}
            </Label>
            <Input
              id="wh-secret"
              type="password"
              placeholder={isEdit ? "••••••••" : "Leave blank to skip signing"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>

          {/* Event Types */}
          <div className="grid gap-2">
            <Label id="wh-events-label">Event Types *</Label>
            <div className="border rounded-md p-3 space-y-2">
              {WEBHOOK_EVENT_TYPES.map((evt) => (
                <label
                  key={evt.value}
                  className="flex items-start gap-2.5 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedEvents.has(evt.value)}
                    onCheckedChange={() => toggleEvent(evt.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium leading-none">{evt.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{evt.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isPending ||
              !name.trim() ||
              !url.trim() ||
              selectedEvents.size === 0
            }
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Secret Display Modal ─────────────────────────────────────────────────────

function SecretModal({
  open,
  secret,
  onClose,
}: {
  open: boolean;
  secret: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-500" />
            Signing Secret
          </DialogTitle>
          <DialogDescription>
            Copy this secret now — it will not be shown again. Use it to verify
            the <code className="text-xs">webhook-signature</code> header on incoming requests.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="bg-muted rounded-md p-3 font-mono text-sm break-all">
            {secret}
          </div>
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() => {
              if (secret) {
                copyToClipboard(secret);
                toast.success("Signing secret copied to clipboard");
              }
            }}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy to Clipboard
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function OutboundWebhooksSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { selectedTeamId } = useTeamStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Endpoint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Endpoint | null>(null);
  const [secretModalSecret, setSecretModalSecret] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const listQuery = useQuery(
    trpc.webhookEndpoint.list.queryOptions(
      { teamId: selectedTeamId ?? "" },
      { enabled: !!selectedTeamId },
    ),
  );

  const toggleMutation = useMutation(
    trpc.webhookEndpoint.toggleEnabled.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.webhookEndpoint.list.queryKey(),
        });
      },
      onError: (err) => {
        toast.error(err.message || "Failed to toggle endpoint", { duration: 6000 });
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.webhookEndpoint.delete.mutationOptions({
      onSuccess: () => {
        setDeleteTarget(null);
        queryClient.invalidateQueries({
          queryKey: trpc.webhookEndpoint.list.queryKey(),
        });
        toast.success("Webhook endpoint deleted");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to delete endpoint", { duration: 6000 });
      },
    }),
  );

  const testMutation = useMutation(
    trpc.webhookEndpoint.testDelivery.mutationOptions({
      onSuccess: (result) => {
        setTestingId(null);
        if ((result as { success?: boolean }).success) {
          toast.success("Test delivery sent successfully");
        } else {
          toast.error(`Test delivery failed: ${(result as { error?: string }).error ?? "unknown error"}`, { duration: 6000 });
        }
      },
      onError: (err) => {
        setTestingId(null);
        toast.error(err.message || "Test delivery failed", { duration: 6000 });
      },
    }),
  );

  function handleTest(id: string) {
    if (!selectedTeamId) return;
    setTestingId(id);
    testMutation.mutate({ id, teamId: selectedTeamId });
  }

  function handleToggle(id: string) {
    if (!selectedTeamId) return;
    toggleMutation.mutate({ id, teamId: selectedTeamId });
  }

  const endpoints = (listQuery.data ?? []) as Endpoint[];

  if (!selectedTeamId) {
    return (
      <div className="space-y-2 p-6">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (listQuery.isError) {
    return (
      <QueryError
        message={listQuery.error?.message || "Failed to load webhook endpoints"}
        onRetry={() => listQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Send HMAC-signed event notifications to external systems
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Endpoint
        </Button>
      </div>

      {/* Endpoints Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Webhook Endpoints
          </CardTitle>
          <CardDescription>
            Endpoints receive signed HTTP POST requests when subscribed events occur.
            Expand a row to view delivery history.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <div className="space-y-2 p-6">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : endpoints.length === 0 ? (
            <EmptyState icon={Webhook} title="No webhook endpoints" description="Add a webhook endpoint to start receiving events." />
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[180px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((ep) => (
                  <EndpointRow
                    key={ep.id}
                    endpoint={ep}
                    teamId={selectedTeamId ?? ""}
                    onEdit={setEditTarget}
                    onDelete={setDeleteTarget}
                    onToggle={handleToggle}
                    onTest={handleTest}
                    testPending={testingId === ep.id}
                  />
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <EndpointDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        teamId={selectedTeamId ?? ""}
        editTarget={null}
        onSuccess={(secret) => {
          if (secret) setSecretModalSecret(secret);
        }}
      />

      {/* Edit dialog */}
      {editTarget && (
        <EndpointDialog
          open={!!editTarget}
          onOpenChange={(v) => !v && setEditTarget(null)}
          teamId={selectedTeamId ?? ""}
          editTarget={editTarget}
          onSuccess={() => {}}
        />
      )}

      {/* Secret display modal */}
      <SecretModal
        open={!!secretModalSecret}
        secret={secretModalSecret}
        onClose={() => setSecretModalSecret(null)}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Delete Webhook Endpoint"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? All delivery history will also be deleted.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget && selectedTeamId) {
            deleteMutation.mutate({ id: deleteTarget.id, teamId: selectedTeamId });
          }
        }}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
