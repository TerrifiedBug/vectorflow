"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Copy, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { SecretsSection } from "@/components/environment/secrets-section";
import { CertificatesSection } from "@/components/environment/certificates-section";
import { GitSyncSection } from "@/components/environment/git-sync-section";
import { nodeStatusVariant, nodeStatusLabel } from "@/lib/status";
import { useTeamStore } from "@/stores/team-store";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";

export default function EnvironmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const envQuery = useQuery(trpc.environment.get.queryOptions({ id }));
  const env = envQuery.data;

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const roleQuery = useQuery({
    ...trpc.team.teamRole.queryOptions({ teamId: selectedTeamId! }),
    enabled: !!selectedTeamId,
  });
  const userRole = roleQuery.data?.role;
  const isAdmin = userRole === "ADMIN";

  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSecretBackend, setEditSecretBackend] = useState<"BUILTIN" | "VAULT" | "AWS_SM" | "EXEC">("BUILTIN");
  const [editVaultConfig, setEditVaultConfig] = useState({
    address: "",
    authMethod: "token" as "token" | "approle" | "kubernetes",
    mountPath: "secret/data/vectorflow",
    role: "",
  });
  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);

  const updateMutation = useMutation(
    trpc.environment.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.environment.get.queryKey({ id }) });
        setEditing(false);
      },
    })
  );

  const deleteMutation = useMutation(
    trpc.environment.delete.mutationOptions({
      onSuccess: () => router.push("/environments"),
    })
  );

  const generateTokenMutation = useMutation(
    trpc.environment.generateEnrollmentToken.mutationOptions({
      onSuccess: (data) => {
        setEnrollmentToken(data.token);
        queryClient.invalidateQueries({ queryKey: trpc.environment.get.queryKey({ id }) });
        toast.success("Enrollment token generated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to generate token", { duration: 6000 });
      },
    })
  );

  const revokeTokenMutation = useMutation(
    trpc.environment.revokeEnrollmentToken.mutationOptions({
      onSuccess: () => {
        setEnrollmentToken(null);
        queryClient.invalidateQueries({ queryKey: trpc.environment.get.queryKey({ id }) });
        toast.success("Enrollment token revoked");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to revoke token", { duration: 6000 });
      },
    })
  );

  function startEditing() {
    if (!env) return;
    setEditName(env.name);
    setEditSecretBackend(env.secretBackend ?? "BUILTIN");
    const vaultCfg = (env.secretBackendConfig as Record<string, string>) ?? {};
    setEditVaultConfig({
      address: vaultCfg.address ?? "",
      authMethod: (vaultCfg.authMethod as "token" | "approle" | "kubernetes") ?? "token",
      mountPath: vaultCfg.mountPath ?? "secret/data/vectorflow",
      role: vaultCfg.role ?? "",
    });
    setEditing(true);
  }

  function handleSave() {
    updateMutation.mutate({
      id,
      name: editName,
      secretBackend: editSecretBackend,
      ...(editSecretBackend === "VAULT" ? {
        secretBackendConfig: editVaultConfig,
      } : editSecretBackend !== "BUILTIN" ? {
        secretBackendConfig: { backend: editSecretBackend },
      } : {}),
    });
  }

  if (envQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (envQuery.isError) {
    return (
      <div className="space-y-6">
        <QueryError message="Failed to load environment" onRetry={() => envQuery.refetch()} />
      </div>
    );
  }

  if (!env) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Environment not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/environments">Back to environments</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        <Link href="/environments" className="text-muted-foreground hover:text-foreground transition-colors">
          Environments
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">{env.name}</span>
      </div>

      {/* Header */}
      <PageHeader
        title={env.name}
        description={env.team?.name ?? "System"}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={startEditing}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit
            </Button>
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete environment?</DialogTitle>
                  <DialogDescription>
                    This will permanently delete &ldquo;{env.name}&rdquo; and all
                    associated pipelines and nodes. This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => deleteMutation.mutate({ id })}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? "Deleting..." : "Delete"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Edit Form */}
      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>Edit Environment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Deployment</CardDescription>
            <CardTitle className="text-lg">Agent</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {env.hasEnrollmentToken ? "Enrollment token configured" : "No enrollment token"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Nodes</CardDescription>
            <CardTitle className="text-lg">{env._count.nodes}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pipelines</CardDescription>
            <CardTitle className="text-lg">{env._count.pipelines}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Deploy Settings */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">Deploy Settings</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="require-approval-toggle" className="text-sm font-medium">
                  Require approval for deploys
                </Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">
                When enabled, editors must request admin approval before deploying pipelines.
                {!isAdmin && " Only admins can change this setting."}
              </p>
            </div>
            <Switch
              id="require-approval-toggle"
              checked={env.requireDeployApproval ?? false}
              disabled={!isAdmin}
              onCheckedChange={(checked) => {
                updateMutation.mutate({ id, requireDeployApproval: checked }, {
                  onSuccess: () => toast.success(checked ? "Deploy approval enabled" : "Deploy approval disabled"),
                  onError: (err) => toast.error(err.message, { duration: 6000 }),
                });
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Nodes Table */}
      <Card>
        <CardHeader>
          <CardTitle>Vector Nodes</CardTitle>
          <CardDescription>
            Nodes registered in this environment
          </CardDescription>
        </CardHeader>
        <CardContent>
          {env.nodes.length === 0 ? (
            <EmptyState
              title="No nodes in this environment yet"
              action={{ label: "Go to Fleet", href: "/fleet" }}
              className="p-8"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {env.nodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/fleet/${node.id}`}
                        className="hover:underline"
                      >
                        {node.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm tabular-nums">
                      {node.host}:{node.apiPort}
                    </TableCell>
                    <TableCell>
                      <StatusBadge variant={nodeStatusVariant(node.status)}>
                        {nodeStatusLabel(node.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {node.lastSeen
                        ? new Date(node.lastSeen).toLocaleString()
                        : "Never"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Agent Enrollment */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agent Enrollment</CardTitle>
              <CardDescription>
                Generate a token for agents to enroll in this environment.
                The token is shown once — save it immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {enrollmentToken && (
                <div className="space-y-2">
                  <Label>Token (save this — it won&apos;t be shown again)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={enrollmentToken}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Copy enrollment token"
                      onClick={async () => {
                        await copyToClipboard(enrollmentToken);
                        toast.success("Token copied to clipboard");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              {env.hasEnrollmentToken && !enrollmentToken && (
                <div className="flex items-center gap-2 rounded-md border p-3">
                  <span className="font-mono text-sm tabular-nums">{env.enrollmentTokenHint}</span>
                  <Badge variant="secondary" className="ml-auto">Active</Badge>
                </div>
              )}

              {/* Quick Start snippets — shown when a token exists */}
              {env.hasEnrollmentToken && (
                <div className="space-y-3 rounded-md border p-4">
                  <p className="text-sm font-medium">Quick Start</p>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Linux (installs agent + Vector)</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label="Copy Linux install command"
                        onClick={async () => {
                          const token = enrollmentToken || "<enrollment-token>";
                          const cmd = `curl -sSfL https://raw.githubusercontent.com/TerrifiedBug/vectorflow/main/agent/install.sh | sudo bash -s -- --url ${window.location.origin} --token ${token}`;
                          await copyToClipboard(cmd);
                          toast.success("Command copied");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <pre className="overflow-x-auto rounded bg-muted px-3 py-2 text-xs">
{`curl -sSfL https://raw.githubusercontent.com/TerrifiedBug/vectorflow/main/agent/install.sh | \\
  sudo bash -s -- --url ${typeof window !== "undefined" ? window.location.origin : "https://your-vectorflow-instance"} --token ${enrollmentToken || "<enrollment-token>"}`}
                    </pre>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Docker</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label="Copy Docker run command"
                        onClick={async () => {
                          const token = enrollmentToken || "<enrollment-token>";
                          const cmd = `docker run -d --name vf-agent --restart unless-stopped \\\n  -e VF_URL=${window.location.origin} \\\n  -e VF_TOKEN=${token} \\\n  -v /var/lib/vf-agent:/var/lib/vf-agent \\\n  ghcr.io/terrifiedbug/vectorflow-agent:latest`;
                          await copyToClipboard(cmd);
                          toast.success("Command copied");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <pre className="overflow-x-auto rounded bg-muted px-3 py-2 text-xs">
{`docker run -d --name vf-agent --restart unless-stopped \\
  -e VF_URL=${typeof window !== "undefined" ? window.location.origin : "https://your-vectorflow-instance"} \\
  -e VF_TOKEN=${enrollmentToken || "<enrollment-token>"} \\
  -v /var/lib/vf-agent:/var/lib/vf-agent \\
  ghcr.io/terrifiedbug/vectorflow-agent:latest`}
                    </pre>
                  </div>

                  <a
                    href="https://docs.vectorflow.io/user-guide/environments#agent-enrollment-tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    View full setup guide
                  </a>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={() => generateTokenMutation.mutate({ environmentId: id })}
                  disabled={generateTokenMutation.isPending}
                  size="sm"
                >
                  {generateTokenMutation.isPending ? "Generating..." : env.hasEnrollmentToken ? "Regenerate Token" : "Generate Token"}
                </Button>
                {env.hasEnrollmentToken && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => revokeTokenMutation.mutate({ environmentId: id })}
                    disabled={revokeTokenMutation.isPending}
                  >
                    {revokeTokenMutation.isPending ? "Revoking..." : "Revoke Token"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

      {/* Secret Backend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Secret Backend</CardTitle>
              <CardDescription>
                Choose how pipelines on this environment resolve secret references.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                {editing ? (
                  <Select value={editSecretBackend} onValueChange={(val) => setEditSecretBackend(val as "BUILTIN" | "VAULT" | "AWS_SM" | "EXEC")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BUILTIN">Built-in (VectorFlow delivers secrets as env vars)</SelectItem>
                      <SelectItem value="VAULT">HashiCorp Vault</SelectItem>
                      <SelectItem value="AWS_SM">AWS Secrets Manager</SelectItem>
                      <SelectItem value="EXEC">Exec (custom script)</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="secondary">
                    {env.secretBackend === "VAULT" ? "HashiCorp Vault" :
                     env.secretBackend === "AWS_SM" ? "AWS Secrets Manager" :
                     env.secretBackend === "EXEC" ? "Exec (custom script)" :
                     "Built-in"}
                  </Badge>
                )}
              </div>

              {/* Vault-specific config fields */}
              {((editing && editSecretBackend === "VAULT") || (!editing && env.secretBackend === "VAULT")) && (
                <div className="space-y-3 border-t pt-3">
                  <div>
                    <label className="text-sm font-medium">Vault Address</label>
                    {editing ? (
                      <Input
                        type="text"
                        value={editVaultConfig.address}
                        onChange={(e) => setEditVaultConfig(prev => ({ ...prev, address: e.target.value }))}
                        placeholder="https://vault.internal:8200"
                        className="mt-1"
                      />
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {(env.secretBackendConfig as Record<string, string>)?.address || "Not configured"}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium">Auth Method</label>
                    {editing ? (
                      <Select value={editVaultConfig.authMethod} onValueChange={(val) => setEditVaultConfig(prev => ({ ...prev, authMethod: val as "token" | "approle" | "kubernetes" }))}>
                        <SelectTrigger className="mt-1 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="token">Token</SelectItem>
                          <SelectItem value="approle">AppRole</SelectItem>
                          <SelectItem value="kubernetes">Kubernetes</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground capitalize">
                        {(env.secretBackendConfig as Record<string, string>)?.authMethod || "token"}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium">Mount Path</label>
                    {editing ? (
                      <Input
                        type="text"
                        value={editVaultConfig.mountPath}
                        onChange={(e) => setEditVaultConfig(prev => ({ ...prev, mountPath: e.target.value }))}
                        placeholder="secret/data/vectorflow"
                        className="mt-1"
                      />
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {(env.secretBackendConfig as Record<string, string>)?.mountPath || "secret/data/vectorflow"}
                      </p>
                    )}
                  </div>
                  {((editing && (editVaultConfig.authMethod === "approle" || editVaultConfig.authMethod === "kubernetes")) ||
                    (!editing && ((env.secretBackendConfig as Record<string, string>)?.authMethod === "approle" || (env.secretBackendConfig as Record<string, string>)?.authMethod === "kubernetes"))) && (
                    <div>
                      <label className="text-sm font-medium">Role</label>
                      {editing ? (
                        <Input
                          type="text"
                          value={editVaultConfig.role}
                          onChange={(e) => setEditVaultConfig(prev => ({ ...prev, role: e.target.value }))}
                          placeholder="vectorflow-agent"
                          className="mt-1"
                        />
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {(env.secretBackendConfig as Record<string, string>)?.role || "\u2014"}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

      {/* Secrets & Certificates */}
      <SecretsSection environmentId={id} />
      <CertificatesSection environmentId={id} />

      <GitSyncSection
        environmentId={id}
        gitRepoUrl={env.gitRepoUrl}
        gitBranch={env.gitBranch}
        hasGitToken={env.hasGitToken}
        gitOpsMode={env.gitOpsMode}
        hasWebhookSecret={env.hasWebhookSecret}
      />

      {/* Created info */}
      <p className="text-xs text-muted-foreground">
        Created {new Date(env.createdAt).toLocaleDateString()}
      </p>
    </div>
  );
}
