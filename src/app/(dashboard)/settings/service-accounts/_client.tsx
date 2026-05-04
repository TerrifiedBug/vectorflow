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
  Ban,
  KeyRound,
  ShieldCheck,
  Clock,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Switch } from "@/components/ui/switch";
import { Breadcrumb } from "@/components/breadcrumb";
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
import { Textarea } from "@/components/ui/textarea";
import {
  SERVICE_ACCOUNT_PERMISSION_GROUPS,
  type ServiceAccountPermission,
} from "@/lib/service-account-permissions";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatExpiresAt(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  if (d.getTime() < now) return "Expired";
  const diffMs = d.getTime() - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 1) return "Today";
  return `${diffDays} days`;
}

// ─── Permission Definitions ─────────────────────────────────────────────────────

const PERMISSION_GROUPS = SERVICE_ACCOUNT_PERMISSION_GROUPS;
type PermissionValue = ServiceAccountPermission;

// ─── Main Page ──────────────────────────────────────────────────────────────────

export function ServiceAccountsSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { selectedTeamId } = useTeamStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");
  const [expiration, setExpiration] = useState<string>("never");
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());

  // Queries
  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId ?? "" },
      { enabled: !!selectedTeamId },
    ),
  );

  const environments = environmentsQuery.data ?? [];

  // If user selected an environment for the list, use it; otherwise use first available
  const listEnvId = selectedEnvId || environments[0]?.id || "";

  const serviceAccountsQuery = useQuery(
    trpc.serviceAccount.list.queryOptions(
      { environmentId: listEnvId },
      { enabled: !!listEnvId },
    ),
  );

  // Mutations
  const createMutation = useMutation(
    trpc.serviceAccount.create.mutationOptions({
      onSuccess: (data) => {
        setCreatedKey(data.rawKey);
        setKeyModalOpen(true);
        setCreateOpen(false);
        resetForm();
        queryClient.invalidateQueries({
          queryKey: trpc.serviceAccount.list.queryKey(),
        });
        toast.success("Service account created");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to create service account", { duration: 6000 });
      },
    }),
  );

  const revokeMutation = useMutation(
    trpc.serviceAccount.revoke.mutationOptions({
      onSuccess: () => {
        setRevokeTarget(null);
        queryClient.invalidateQueries({
          queryKey: trpc.serviceAccount.list.queryKey(),
        });
        toast.success("Service account revoked");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to revoke service account", { duration: 6000 });
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.serviceAccount.delete.mutationOptions({
      onSuccess: () => {
        setDeleteTarget(null);
        queryClient.invalidateQueries({
          queryKey: trpc.serviceAccount.list.queryKey(),
        });
        toast.success("Service account deleted");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to delete service account", { duration: 6000 });
      },
    }),
  );

  function resetForm() {
    setName("");
    setDescription("");
    setExpiration("never");
    setSelectedPermissions(new Set());
  }

  function togglePermission(perm: string) {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) {
        next.delete(perm);
      } else {
        next.add(perm);
      }
      return next;
    });
  }

  function handleCreate() {
    if (!name.trim() || !selectedEnvId || selectedPermissions.size === 0) {
      toast.error("Please fill in all required fields and select at least one permission", { duration: 6000 });
      return;
    }

    const expiresInDays =
      expiration === "never" ? undefined : parseInt(expiration, 10);

    createMutation.mutate({
      environmentId: selectedEnvId,
      name: name.trim(),
      description: description.trim() || undefined,
      permissions: Array.from(selectedPermissions) as PermissionValue[],
      expiresInDays,
    });
  }

  const serviceAccounts = serviceAccountsQuery.data ?? [];
  const isLoading = serviceAccountsQuery.isLoading || environmentsQuery.isLoading;

  if (serviceAccountsQuery.isError) return <QueryError message="Failed to load service accounts" onRetry={() => serviceAccountsQuery.refetch()} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage API keys for programmatic access to the REST API
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Service Account
        </Button>
      </div>

      {/* Environment Selector */}
      {environments.length > 1 && (
        <div className="flex items-center gap-3">
          <Label htmlFor="sa-list-env">Environment</Label>
          <Select value={listEnvId} onValueChange={setSelectedEnvId}>
            <SelectTrigger id="sa-list-env" className="w-[200px]">
              <SelectValue placeholder="Select environment" />
            </SelectTrigger>
            <SelectContent>
              {environments.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  {env.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Service Accounts Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Service Accounts
          </CardTitle>
          <CardDescription>
            Service accounts provide API keys for the REST API. Keys are shown
            once at creation and cannot be retrieved afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : serviceAccounts.length === 0 ? (
            <EmptyState icon={KeyRound} title="No service accounts" description="Create a service account to authenticate external systems." />
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key Prefix</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serviceAccounts.map((sa) => {
                  const permissions = (sa.permissions as string[]) ?? [];
                  const isExpired =
                    sa.expiresAt && new Date(sa.expiresAt) < new Date();
                  const status = !sa.enabled
                    ? "Revoked"
                    : isExpired
                      ? "Expired"
                      : "Active";
                  const statusVariant =
                    status === "Active"
                      ? "default"
                      : status === "Revoked"
                        ? "destructive"
                        : "secondary";

                  return (
                    <TableRow key={sa.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{sa.name}</div>
                          {sa.description && (
                            <div className="text-xs text-muted-foreground">
                              {sa.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {sa.keyPrefix}...
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {permissions.map((p) => (
                            <Badge
                              key={p}
                              variant="outline"
                              className="text-[10px] px-1 py-0"
                            >
                              {p}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(sa.lastUsedAt)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatExpiresAt(sa.expiresAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant}>{status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {sa.createdBy?.name || sa.createdBy?.email || "Unknown"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {sa.enabled && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Revoke"
                              onClick={() =>
                                setRevokeTarget({ id: sa.id, name: sa.name })
                              }
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            title="Delete"
                            onClick={() =>
                              setDeleteTarget({ id: sa.id, name: sa.name })
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) resetForm();
          setCreateOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Service Account</DialogTitle>
            <DialogDescription>
              Generate an API key for programmatic access. The key will only be
              shown once.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Name */}
            <div className="grid gap-2">
              <Label htmlFor="sa-name">Name *</Label>
              <Input
                id="sa-name"
                placeholder="e.g., CI/CD Pipeline Deployer"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="sa-desc">Description</Label>
              <Textarea
                id="sa-desc"
                placeholder="Optional description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            {/* Environment */}
            <div className="grid gap-2">
              <Label htmlFor="sa-create-env">Environment *</Label>
              <Select value={selectedEnvId} onValueChange={setSelectedEnvId}>
                <SelectTrigger id="sa-create-env">
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  {environments.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Expiration */}
            <div className="grid gap-2">
              <Label htmlFor="sa-create-expiration">Expiration</Label>
              <Select value={expiration} onValueChange={setExpiration}>
                <SelectTrigger id="sa-create-expiration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="60">60 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="never">Never</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Permissions */}
            <div className="grid gap-2">
              <Label id="sa-create-permissions-label">Permissions *</Label>
              <div className="border rounded-md p-3 space-y-3">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.label}>
                    <div className="text-sm font-medium mb-1.5">
                      {group.label}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {group.permissions.map((perm) => (
                        <label
                          key={perm.value}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <Switch
                            checked={selectedPermissions.has(perm.value)}
                            onCheckedChange={() =>
                              togglePermission(perm.value)
                            }
                          />
                          <span className="text-sm">{perm.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                createMutation.isPending ||
                !name.trim() ||
                !selectedEnvId ||
                selectedPermissions.size === 0
              }
            >
              {createMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* API Key Display Modal */}
      <Dialog
        open={keyModalOpen}
        onOpenChange={(open) => {
          if (!open) setCreatedKey(null);
          setKeyModalOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-500" />
              API Key Created
            </DialogTitle>
            <DialogDescription>
              Copy your API key now. It will not be shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-muted rounded-md p-3 font-mono text-sm break-all">
              {createdKey}
            </div>
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={() => {
                if (createdKey) {
                  copyToClipboard(createdKey);
                  toast.success("API key copied to clipboard");
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy to Clipboard
            </Button>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                setKeyModalOpen(false);
                setCreatedKey(null);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation */}
      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke Service Account"
        description={`Are you sure you want to revoke "${revokeTarget?.name}"? The API key will immediately stop working.`}
        confirmLabel="Revoke"
        variant="destructive"
        onConfirm={() => {
          if (revokeTarget) {
            revokeMutation.mutate({ id: revokeTarget.id });
          }
        }}
        isPending={revokeMutation.isPending}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Service Account"
        description={`Are you sure you want to permanently delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id });
          }
        }}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}

// ─── Page Wrapper ────────────────────────────────────────────────────────────────

export default function ServiceAccountsPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="space-y-2 mb-6">
        <Breadcrumb items={[
          { label: "Settings", href: "/settings" },
          { label: "Service Accounts" },
        ]} />
        <h1 className="text-2xl font-semibold">Service Accounts</h1>
      </div>
      <ServiceAccountsSettings />
    </div>
  );
}
