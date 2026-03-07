"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { copyToClipboard } from "@/lib/utils";
import { toast } from "sonner";
import {
  Shield,
  Server,
  Users,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Lock,
  Unlock,
  KeyRound,
  Copy,
  UserPlus,
  Crown,
  Layers,
  Plus,
  X,
  RefreshCw,
  ExternalLink,
  HardDrive,
  Download,
  AlertTriangle,
  Clock,
  Link2,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";


// ─── Relative Time Helper ───────────────────────────────────────────────────────

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

// ─── Version Check Section ──────────────────────────────────────────────────────

function VersionCheckSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [isChecking, setIsChecking] = useState(false);

  const versionQuery = useQuery(
    trpc.settings.checkVersion.queryOptions(undefined, {
      refetchInterval: false,
      staleTime: Infinity,
    }),
  );

  const handleCheckNow = async () => {
    setIsChecking(true);
    try {
      await queryClient.fetchQuery(
        trpc.settings.checkVersion.queryOptions({ force: true }, { staleTime: 0 }),
      );
      // Invalidate to pick up the fresh data
      await queryClient.invalidateQueries({
        queryKey: trpc.settings.checkVersion.queryKey(),
      });
    } catch {
      toast.error("Failed to check for updates");
    } finally {
      setIsChecking(false);
    }
  };

  const server = versionQuery.data?.server;
  const agent = versionQuery.data?.agent;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Version Information</CardTitle>
            <CardDescription>
              Current and latest versions of VectorFlow components
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckNow}
            disabled={isChecking || versionQuery.isLoading}
          >
            {isChecking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Check now
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {versionQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-48" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Server version */}
            <div className="grid grid-cols-[140px_1fr] items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">Server version</span>
              <span className="font-mono">{server?.currentVersion ?? "unknown"}</span>

              <span className="text-muted-foreground">Latest server</span>
              <div className="flex items-center gap-2">
                <span className="font-mono">
                  {server?.latestVersion ?? "unknown"}
                </span>
                {server?.updateAvailable && (
                  <Badge variant="secondary" className="text-xs">
                    Update available
                  </Badge>
                )}
                {server?.latestVersion &&
                  !server.updateAvailable &&
                  server.currentVersion !== "dev" && (
                    <Badge
                      variant="outline"
                      className="text-xs text-green-600 border-green-600"
                    >
                      Up to date
                    </Badge>
                  )}
                {server?.releaseUrl && (
                  <a
                    href={server.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Release notes
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            <Separator />

            {/* Agent version */}
            <div className="grid grid-cols-[140px_1fr] items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">Latest agent</span>
              <span className="font-mono">
                {agent?.latestVersion ?? "unknown"}
              </span>
            </div>

            <Separator />

            {/* Last checked */}
            <p className="text-xs text-muted-foreground">
              Last checked: {formatRelativeTime(server?.checkedAt)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Audit Log Shipping Section ─────────────────────────────────────────────

function AuditLogShippingSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const systemPipelineQuery = useQuery(
    trpc.pipeline.getSystemPipeline.queryOptions(),
  );

  const createSystemPipelineMutation = useMutation(
    trpc.pipeline.createSystemPipeline.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.getSystemPipeline.queryKey(),
        });
        toast.success("Audit log shipping pipeline created");
      },
      onError: (error) => {
        if (error.message?.includes("already exists")) {
          queryClient.invalidateQueries({
            queryKey: trpc.pipeline.getSystemPipeline.queryKey(),
          });
        } else {
          toast.error(error.message || "Failed to create system pipeline");
        }
      },
    }),
  );

  const undeployMutation = useMutation(
    trpc.deploy.undeploy.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.getSystemPipeline.queryKey(),
        });
        toast.success("Audit log shipping disabled");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to disable audit log shipping");
      },
    }),
  );

  const deployMutation = useMutation(
    trpc.deploy.agent.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.getSystemPipeline.queryKey(),
        });
        toast.success("Audit log shipping enabled");
      },
      onError: (error: { message?: string }) => {
        toast.error(error.message || "Failed to enable audit log shipping");
      },
    }),
  );

  const systemPipeline = systemPipelineQuery.data;
  const isLoading = systemPipelineQuery.isLoading;
  const isDeployed = systemPipeline && !systemPipeline.isDraft && systemPipeline.deployedAt;
  const isToggling = undeployMutation.isPending || deployMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Audit Log Shipping</CardTitle>
            <CardDescription>
              Ship audit logs to external destinations via Vector. Configure
              transforms and sinks in the pipeline editor.
            </CardDescription>
          </div>
          {!isLoading && systemPipeline && (
            <Badge
              variant="outline"
              className={
                isDeployed
                  ? "text-xs text-green-600 border-green-600"
                  : "text-xs text-yellow-600 border-yellow-600"
              }
            >
              {isDeployed ? (
                <>
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Active
                </>
              ) : (
                <>
                  <XCircle className="mr-1 h-3 w-3" />
                  Disabled
                </>
              )}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-9 w-48" />
        ) : systemPipeline ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Audit log shipping is {isDeployed ? "active" : "configured but disabled"}.
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/pipelines/${systemPipeline.id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Configure sinks
              </Link>
            </Button>
            {isDeployed ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  undeployMutation.mutate({ pipelineId: systemPipeline.id })
                }
                disabled={isToggling}
              >
                {undeployMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Disabling...
                  </>
                ) : (
                  "Disable"
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  deployMutation.mutate({ pipelineId: systemPipeline.id, changelog: "Enabled system pipeline from settings" })
                }
                disabled={isToggling}
              >
                {deployMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Enabling...
                  </>
                ) : (
                  "Enable"
                )}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Audit log shipping is not configured.
            </span>
            <Button
              size="sm"
              onClick={() => createSystemPipelineMutation.mutate()}
              disabled={createSystemPipelineMutation.isPending}
            >
              {createSystemPipelineMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Enable Audit Log Shipping"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Auth Tab ──────────────────────────────────────────────────────────────────

function AuthSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const settings = settingsQuery.data;

  const hasLoadedRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);
  const markDirty = useCallback(() => setIsDirty(true), []);

  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [displayName, setDisplayName] = useState("SSO");
  const [tokenAuthMethod, setTokenAuthMethod] = useState<"client_secret_post" | "client_secret_basic">("client_secret_post");

  useEffect(() => {
    if (!settings) return;
    if (hasLoadedRef.current && isDirty) return; // Don't overwrite dirty state on refetch
    hasLoadedRef.current = true;
    setIssuer(settings.oidcIssuer ?? "");
    setClientId(settings.oidcClientId ?? "");
    setDisplayName(settings.oidcDisplayName ?? "SSO");
    setTokenAuthMethod((settings.oidcTokenEndpointAuthMethod as "client_secret_post" | "client_secret_basic") ?? "client_secret_post");
    // Don't populate clientSecret - it's masked
  }, [settings, isDirty]);

  const updateOidcMutation = useMutation(
    // eslint-disable-next-line react-hooks/refs
    trpc.settings.updateOidc.mutationOptions({
      onSuccess: () => {
        setIsDirty(false);
        hasLoadedRef.current = false; // Allow next sync from server
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("OIDC settings saved successfully");
        setClientSecret("");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save OIDC settings");
      },
    })
  );

  const testOidcMutation = useMutation(
    trpc.settings.testOidc.mutationOptions({
      onSuccess: (data) => {
        toast.success(`OIDC connection successful. Issuer: ${data.issuer}`);
      },
      onError: (error) => {
        toast.error(error.message || "OIDC connection test failed");
      },
    })
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientSecret && !settings?.oidcClientSecret) {
      toast.error("Client secret is required");
      return;
    }
    updateOidcMutation.mutate({
      issuer,
      clientId,
      clientSecret: clientSecret || "unchanged",
      displayName,
      tokenEndpointAuthMethod: tokenAuthMethod,
    });
  };

  const handleTest = () => {
    if (!issuer) {
      toast.error("Please enter an issuer URL first");
      return;
    }
    testOidcMutation.mutate({ issuer });
  };

  const [teamMappings, setTeamMappings] = useState<Array<{group: string; teamId: string; role: "VIEWER" | "EDITOR" | "ADMIN"}>>([]);
  const [defaultTeamId, setDefaultTeamId] = useState("");
  const [defaultRole, setDefaultRole] = useState<"VIEWER" | "EDITOR" | "ADMIN">("VIEWER");
  const [groupSyncEnabled, setGroupSyncEnabled] = useState(false);
  const [groupsScope, setGroupsScope] = useState("groups");
  const [groupsClaim, setGroupsClaim] = useState("groups");

  const teamsQuery = useQuery(trpc.admin.listTeams.queryOptions());

  useEffect(() => {
    if (!settings) return;
    if (hasLoadedRef.current && isDirty) return; // Don't overwrite dirty state on refetch
    setDefaultRole((settings.oidcDefaultRole as "VIEWER" | "EDITOR" | "ADMIN") ?? "VIEWER");
    setGroupSyncEnabled(settings.oidcGroupSyncEnabled ?? false);
    setGroupsScope(settings.oidcGroupsScope ?? "");
    setGroupsClaim(settings.oidcGroupsClaim ?? "groups");
    setTeamMappings((settings.oidcTeamMappings ?? []) as Array<{group: string; teamId: string; role: "VIEWER" | "EDITOR" | "ADMIN"}>);
    setDefaultTeamId(settings.oidcDefaultTeamId ?? "");
  }, [settings, isDirty]);

  const updateTeamMappingMutation = useMutation(
    // eslint-disable-next-line react-hooks/refs
    trpc.settings.updateOidcTeamMappings.mutationOptions({
      onSuccess: () => {
        setIsDirty(false);
        hasLoadedRef.current = false; // Allow next sync from server
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("OIDC team mapping saved");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save team mapping");
      },
    })
  );

  function addMapping() {
    markDirty();
    setTeamMappings([...teamMappings, { group: "", teamId: "", role: "VIEWER" }]);
  }

  function removeMapping(index: number) {
    markDirty();
    setTeamMappings(teamMappings.filter((_, i) => i !== index));
  }

  function updateMapping(index: number, field: keyof typeof teamMappings[number], value: string) {
    markDirty();
    setTeamMappings(teamMappings.map((m, i) =>
      i === index ? { ...m, [field]: value } as typeof m : m
    ));
  }

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  if (settingsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>OIDC / SSO Configuration</CardTitle>
        <CardDescription>
          Configure an OpenID Connect provider to enable single sign-on for your
          team.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="oidc-issuer">Issuer URL</Label>
            <Input
              id="oidc-issuer"
              type="url"
              placeholder="https://accounts.google.com"
              value={issuer}
              onChange={(e) => { markDirty(); setIssuer(e.target.value); }}
              required
            />
            <p className="text-xs text-muted-foreground">
              The OIDC issuer URL (must support .well-known/openid-configuration)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidc-client-id">Client ID</Label>
            <Input
              id="oidc-client-id"
              placeholder="your-client-id"
              value={clientId}
              onChange={(e) => { markDirty(); setClientId(e.target.value); }}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidc-client-secret">Client Secret</Label>
            <Input
              id="oidc-client-secret"
              type="password"
              placeholder={
                settings?.oidcClientSecret
                  ? `Current: ${settings.oidcClientSecret}`
                  : "Enter client secret"
              }
              value={clientSecret}
              onChange={(e) => { markDirty(); setClientSecret(e.target.value); }}
              required={!settings?.oidcClientSecret}
            />
            <p className="text-xs text-muted-foreground">
              {settings?.oidcClientSecret
                ? "Leave blank to keep the existing secret, or enter a new one to replace it."
                : "The client secret from your OIDC provider."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidc-display-name">Display Name</Label>
            <Input
              id="oidc-display-name"
              placeholder="SSO"
              value={displayName}
              onChange={(e) => { markDirty(); setDisplayName(e.target.value); }}
              required
            />
            <p className="text-xs text-muted-foreground">
              The label shown on the login button (e.g., &quot;Sign in with
              Okta&quot;)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidc-auth-method">Token Auth Method</Label>
            <Select
              value={tokenAuthMethod}
              onValueChange={(val: "client_secret_post" | "client_secret_basic") => { markDirty(); setTokenAuthMethod(val); }}
            >
              <SelectTrigger id="oidc-auth-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client_secret_post">client_secret_post (default)</SelectItem>
                <SelectItem value="client_secret_basic">client_secret_basic</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How the client secret is sent to the token endpoint. Most providers use client_secret_post.
            </p>
          </div>

          <Separator />

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={
                updateOidcMutation.isPending || !issuer || !clientId
              }
            >
              {updateOidcMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save OIDC Settings"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={testOidcMutation.isPending || !issuer}
            >
              {testOidcMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : testOidcMutation.isSuccess ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                  Connection OK
                </>
              ) : testOidcMutation.isError ? (
                <>
                  <XCircle className="mr-2 h-4 w-4 text-destructive" />
                  Test Failed
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>OIDC Team & Role Mapping</CardTitle>
        <CardDescription>
          Map OIDC groups to specific teams and roles. Users are assigned to teams
          based on their group membership when signing in via SSO.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => {
          e.preventDefault();
          updateTeamMappingMutation.mutate({
            mappings: teamMappings.filter((m) => m.group && m.teamId),
            defaultTeamId: defaultTeamId || undefined,
            defaultRole,
            groupSyncEnabled,
            groupsScope,
            groupsClaim,
          });
        }} className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="oidc-group-sync">Enable Group Sync</Label>
              <p className="text-xs text-muted-foreground">
                Request group claims from your OIDC provider and sync team memberships
              </p>
            </div>
            <Switch
              id="oidc-group-sync"
              checked={groupSyncEnabled}
              onCheckedChange={setGroupSyncEnabled}
            />
          </div>

          {groupSyncEnabled && (<>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="oidc-groups-scope">Groups Scope</Label>
              <Input
                id="oidc-groups-scope"
                placeholder="groups"
                value={groupsScope}
                onChange={(e) => { setGroupsScope(e.target.value); }}
              />
              <p className="text-xs text-muted-foreground">
                Extra scope to request. Leave empty if your provider includes groups automatically (e.g., Azure AD, Cognito).
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="oidc-groups-claim">Groups Claim</Label>
              <Input
                id="oidc-groups-claim"
                placeholder="groups"
                value={groupsClaim}
                onChange={(e) => { setGroupsClaim(e.target.value); }}
                required
              />
              <p className="text-xs text-muted-foreground">
                Token claim containing group names (e.g., &quot;groups&quot;, &quot;cognito:groups&quot;)
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Group Mappings</Label>
            {teamMappings.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group Name</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamMappings.map((mapping, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Input
                          value={mapping.group}
                          onChange={(e) => updateMapping(index, "group", e.target.value)}
                          placeholder="e.g., vectorflow-admins"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.teamId}
                          onValueChange={(val) => updateMapping(index, "teamId", val)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select team" />
                          </SelectTrigger>
                          <SelectContent>
                            {(teamsQuery.data ?? []).map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.role}
                          onValueChange={(val) => updateMapping(index, "role", val)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="VIEWER">Viewer</SelectItem>
                            <SelectItem value="EDITOR">Editor</SelectItem>
                            <SelectItem value="ADMIN">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove mapping"
                          onClick={() => removeMapping(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Button type="button" variant="outline" size="sm" onClick={addMapping}>
              <Plus className="mr-2 h-4 w-4" />
              Add Mapping
            </Button>
            {teamMappings.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No mappings configured. SSO users will be assigned to the default team with the default role.
              </p>
            )}
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="oidc-default-team">Default Team</Label>
              <Select value={defaultTeamId} onValueChange={(val) => { setDefaultTeamId(val); }}>
                <SelectTrigger id="oidc-default-team">
                  <SelectValue placeholder="Select default team" />
                </SelectTrigger>
                <SelectContent>
                  {(teamsQuery.data ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Fallback team for users who don&apos;t match any group mapping
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="oidc-default-role">Default Role</Label>
              <Select
                value={defaultRole}
                onValueChange={(val: "VIEWER" | "EDITOR" | "ADMIN") => { setDefaultRole(val); }}
              >
                <SelectTrigger id="oidc-default-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                  <SelectItem value="EDITOR">Editor</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          </>)}
          <Button type="submit" disabled={updateTeamMappingMutation.isPending}>
            {updateTeamMappingMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Team Mapping"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
    </div>
  );
}

// ─── Fleet Tab ─────────────────────────────────────────────────────────────────

function FleetSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const settings = settingsQuery.data;

  const [pollIntervalSec, setPollIntervalSec] = useState(15);
  const [unhealthyThreshold, setUnhealthyThreshold] = useState(3);
  const [metricsRetentionDays, setMetricsRetentionDays] = useState(7);
  const [fleetDirty, setFleetDirty] = useState(false);

  useEffect(() => {
    if (!settings) return;
    if (fleetDirty) return; // Don't overwrite dirty state on refetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPollIntervalSec(Math.round(settings.fleetPollIntervalMs / 1000));
    setUnhealthyThreshold(settings.fleetUnhealthyThreshold);
    if (settings.metricsRetentionDays) setMetricsRetentionDays(settings.metricsRetentionDays);
  }, [settings, fleetDirty]);

  const updateFleetMutation = useMutation(
    trpc.settings.updateFleet.mutationOptions({
      onSuccess: () => {
        setFleetDirty(false);
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("Fleet settings saved successfully");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save fleet settings");
      },
    })
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateFleetMutation.mutate({
      pollIntervalMs: pollIntervalSec * 1000,
      unhealthyThreshold,
      metricsRetentionDays,
    });
  };

  if (settingsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fleet Polling Configuration</CardTitle>
        <CardDescription>
          Configure how frequently VectorFlow polls fleet nodes for health status
          updates.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="poll-interval">Poll Interval (seconds)</Label>
            <Input
              id="poll-interval"
              type="number"
              min={1}
              max={300}
              value={pollIntervalSec}
              onChange={(e) => { setFleetDirty(true); setPollIntervalSec(Number(e.target.value)); }}
              required
            />
            <p className="text-xs text-muted-foreground">
              How often to check node health (1-300 seconds)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="unhealthy-threshold">Unhealthy Threshold</Label>
            <Input
              id="unhealthy-threshold"
              type="number"
              min={1}
              max={100}
              value={unhealthyThreshold}
              onChange={(e) => { setFleetDirty(true); setUnhealthyThreshold(Number(e.target.value)); }}
              required
            />
            <p className="text-xs text-muted-foreground">
              Number of consecutive failed polls before marking a node as
              unhealthy
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="metrics-retention">Metrics Retention (days)</Label>
            <Input
              id="metrics-retention"
              type="number"
              min={1}
              max={365}
              value={metricsRetentionDays}
              onChange={(e) => { setFleetDirty(true); setMetricsRetentionDays(Number(e.target.value)); }}
              required
            />
            <p className="text-xs text-muted-foreground">
              How long to keep pipeline metrics data (1-365 days)
            </p>
          </div>

          <Button type="submit" disabled={updateFleetMutation.isPending}>
            {updateFleetMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Fleet Settings"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Team Tab ──────────────────────────────────────────────────────────────────

function TeamSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const teamQuery = useQuery(
    trpc.team.get.queryOptions(
      { id: selectedTeamId! },
      { enabled: !!selectedTeamId }
    )
  );

  const team = teamQuery.data;

  const [teamName, setTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"VIEWER" | "EDITOR" | "ADMIN">(
    "VIEWER"
  );
  const [newTag, setNewTag] = useState("");

  const updateRoleMutation = useMutation(
    trpc.team.updateMemberRole.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.get.queryKey() });
        toast.success("Member role updated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update role");
      },
    })
  );

  const removeMemberMutation = useMutation(
    trpc.team.removeMember.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.get.queryKey() });
        toast.success("Member removed");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to remove member");
      },
    })
  );

  const addMemberMutation = useMutation(
    trpc.team.addMember.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.get.queryKey() });
        toast.success("Member added");
        setInviteEmail("");
        setInviteRole("VIEWER");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to add member");
      },
    })
  );

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const oidcConfigured = !!(settingsQuery.data?.oidcIssuer && settingsQuery.data?.oidcClientId);

  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState<{ userId: string; name: string } | null>(null);
  const [lockConfirm, setLockConfirm] = useState<{ userId: string; name: string; action: "lock" | "unlock" } | null>(null);
  const [removeMember, setRemoveMember] = useState<{ userId: string; name: string } | null>(null);
  const [linkToOidcConfirm, setLinkToOidcConfirm] = useState<{ userId: string; name: string } | null>(null);

  const linkToOidcMutation = useMutation(
    trpc.team.linkMemberToOidc.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.get.queryKey({ id: selectedTeamId! }) });
        toast.success("User linked to SSO");
        setLinkToOidcConfirm(null);
      },
      onError: (error) => toast.error(error.message),
    })
  );

  const lockMutation = useMutation(
    trpc.team.lockMember.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.get.queryKey({ id: selectedTeamId! }) });
        toast.success("User locked");
      },
      onError: (error) => toast.error(error.message),
    })
  );

  const unlockMutation = useMutation(
    trpc.team.unlockMember.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.get.queryKey({ id: selectedTeamId! }) });
        toast.success("User unlocked");
      },
      onError: (error) => toast.error(error.message),
    })
  );

  const resetPasswordMutation = useMutation(
    trpc.team.resetMemberPassword.mutationOptions({
      onSuccess: (data) => {
        setTempPassword(data.temporaryPassword);
        setResetPasswordOpen(true);
      },
      onError: (error) => toast.error(error.message),
    })
  );

  const renameMutation = useMutation(
    trpc.team.rename.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.get.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.team.list.queryKey() });
        toast.success("Team renamed");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to rename team");
      },
    })
  );

  const requireTwoFactorMutation = useMutation(
    trpc.team.updateRequireTwoFactor.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.get.queryKey() });
        toast.success("2FA requirement updated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update 2FA requirement");
      },
    })
  );

  // Data classification tags
  const availableTagsQuery = useQuery(
    trpc.team.getAvailableTags.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );
  const availableTags = availableTagsQuery.data ?? [];
  const tagsQueryKey = trpc.team.getAvailableTags.queryKey({ teamId: selectedTeamId! });

  const updateTagsMutation = useMutation(
    trpc.team.updateAvailableTags.mutationOptions({
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey: tagsQueryKey });
        const previous = queryClient.getQueryData(tagsQueryKey);
        const previousInput = newTag;
        queryClient.setQueryData(tagsQueryKey, variables.tags);
        setNewTag("");
        return { previous, previousInput };
      },
      onError: (error, _variables, context) => {
        if (context?.previous !== undefined) {
          queryClient.setQueryData(tagsQueryKey, context.previous);
        }
        if (context?.previousInput !== undefined) {
          setNewTag(context.previousInput);
        }
        toast.error(error.message || "Failed to update tags");
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: tagsQueryKey });
      },
      onSuccess: () => {
        toast.success("Tags updated");
      },
    }),
  );

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTag.trim();
    if (!selectedTeamId || !trimmed) return;
    if (availableTags.includes(trimmed)) {
      toast.error("Tag already exists");
      return;
    }
    updateTagsMutation.mutate({
      teamId: selectedTeamId,
      tags: [...availableTags, trimmed],
    });
  };

  const handleRemoveTag = (tag: string) => {
    if (!selectedTeamId) return;
    updateTagsMutation.mutate({
      teamId: selectedTeamId,
      tags: availableTags.filter((t) => t !== tag),
    });
  };

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeamId || !teamName.trim()) return;
    renameMutation.mutate({ teamId: selectedTeamId, name: teamName.trim() });
  };

  // Sync team name state when data loads
  useEffect(() => {
    if (team?.name && !teamName) setTeamName(team.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.name]);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeamId || !inviteEmail) return;
    addMemberMutation.mutate({
      teamId: selectedTeamId,
      email: inviteEmail,
      role: inviteRole,
    });
  };

  if (teamQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!team) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">No team found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>
            Manage your team name and settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRename} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Team name"
              />
            </div>
            <Button
              type="submit"
              disabled={renameMutation.isPending || teamName.trim() === team.name}
            >
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </CardTitle>
          <CardDescription>
            Security settings for {team.name}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Require Two-Factor Authentication</Label>
              <p className="text-xs text-muted-foreground">
                Members without 2FA enabled will be prompted to set it up on login.
              </p>
            </div>
            <Switch
              checked={team.requireTwoFactor}
              onCheckedChange={(checked) => {
                if (selectedTeamId) {
                  requireTwoFactorMutation.mutate({
                    teamId: selectedTeamId,
                    requireTwoFactor: checked,
                  });
                }
              }}
              disabled={requireTwoFactorMutation.isPending}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            Manage members and their roles for {team.name}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>2FA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[150px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    {member.user.name || "Unnamed"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {member.user.email}
                      {member.user.authMethod === "LOCAL" && (
                        <Badge variant="outline">Local</Badge>
                      )}
                      {member.user.authMethod === "OIDC" && (
                        <Badge variant="secondary">SSO</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={member.role}
                      disabled={updateRoleMutation.isPending}
                      onValueChange={(role: "VIEWER" | "EDITOR" | "ADMIN") => {
                        updateRoleMutation.mutate({
                          teamId: team.id,
                          userId: member.user.id,
                          role,
                        });
                      }}
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="VIEWER">Viewer</SelectItem>
                        <SelectItem value="EDITOR">Editor</SelectItem>
                        <SelectItem value="ADMIN">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {member.user.totpEnabled ? (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                        <Shield className="mr-1 h-3 w-3" />
                        Enabled
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {member.user.lockedAt ? (
                      <Badge variant="destructive" className="text-xs">
                        <Lock className="mr-1 h-3 w-3" />
                        Locked
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                        Active
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {member.user.lockedAt ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Unlock user"
                          aria-label="Unlock user"
                          onClick={() => setLockConfirm({ userId: member.user.id, name: member.user.name || member.user.email, action: "unlock" })}
                        >
                          <Unlock className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Lock user"
                          aria-label="Lock user"
                          onClick={() => setLockConfirm({ userId: member.user.id, name: member.user.name || member.user.email, action: "lock" })}
                        >
                          <Lock className="h-4 w-4" />
                        </Button>
                      )}
                      {member.user.authMethod !== "OIDC" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Reset password"
                          aria-label="Reset password"
                          onClick={() => setResetPasswordConfirm({ userId: member.user.id, name: member.user.name || member.user.email })}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                      )}
                      {member.user.authMethod === "LOCAL" && oidcConfigured && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Link to SSO"
                          aria-label="Link to SSO"
                          onClick={() => setLinkToOidcConfirm({ userId: member.user.id, name: member.user.name || member.user.email })}
                        >
                          <Link2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Remove member"
                        onClick={() => setRemoveMember({ userId: member.user.id, name: member.user.name || member.user.email })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Reset Password Confirmation Dialog */}
      <Dialog open={!!resetPasswordConfirm} onOpenChange={(open) => {
        if (!open) {
          setResetPasswordConfirm(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          {resetPasswordOpen && tempPassword ? (
            <>
              <DialogHeader>
                <DialogTitle>Temporary Password</DialogTitle>
                <DialogDescription>
                  Share this temporary password with the user. They will be required to change it on next login.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <Input value={tempPassword} readOnly className="font-mono" aria-label="Temporary password" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy temporary password"
                  onClick={async () => {
                    await copyToClipboard(tempPassword);
                    toast.success("Copied to clipboard");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => {
                  setResetPasswordConfirm(null);
                  setResetPasswordOpen(false);
                  setTempPassword("");
                }}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Reset password?</DialogTitle>
                <DialogDescription>
                  This will generate a new temporary password for <span className="font-medium">{resetPasswordConfirm?.name}</span>. They will be required to change it on next login.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResetPasswordConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={resetPasswordMutation.isPending}
                  onClick={() => {
                    if (!resetPasswordConfirm) return;
                    resetPasswordMutation.mutate({ teamId: team.id, userId: resetPasswordConfirm.userId });
                  }}
                >
                  {resetPasswordMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Lock/Unlock Confirmation Dialog */}
      <Dialog open={!!lockConfirm} onOpenChange={(open) => !open && setLockConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lockConfirm?.action === "lock" ? "Lock user?" : "Unlock user?"}</DialogTitle>
            <DialogDescription>
              {lockConfirm?.action === "lock"
                ? <><span className="font-medium">{lockConfirm?.name}</span> will be unable to log in until unlocked.</>
                : <><span className="font-medium">{lockConfirm?.name}</span> will be able to log in again.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={lockConfirm?.action === "lock" ? "destructive" : "default"}
              disabled={lockMutation.isPending || unlockMutation.isPending}
              onClick={() => {
                if (!lockConfirm) return;
                if (lockConfirm.action === "lock") {
                  lockMutation.mutate({ teamId: team.id, userId: lockConfirm.userId }, { onSuccess: () => setLockConfirm(null) });
                } else {
                  unlockMutation.mutate({ teamId: team.id, userId: lockConfirm.userId }, { onSuccess: () => setLockConfirm(null) });
                }
              }}
            >
              {lockConfirm?.action === "lock" ? "Lock" : "Unlock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link to SSO Confirmation Dialog */}
      <Dialog open={!!linkToOidcConfirm} onOpenChange={(open) => !open && setLinkToOidcConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link to SSO?</DialogTitle>
            <DialogDescription>
              This will convert <span className="font-medium">{linkToOidcConfirm?.name}</span> from local authentication to SSO. This action:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-1">
            <li>Removes their password — they can no longer log in with email/password</li>
            <li>Disables their TOTP 2FA — the SSO provider handles MFA</li>
            <li>Requires them to log in via SSO going forward</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkToOidcConfirm(null)}>
              Cancel
            </Button>
            <Button
              disabled={linkToOidcMutation.isPending}
              onClick={() => {
                if (!linkToOidcConfirm) return;
                linkToOidcMutation.mutate({ teamId: team.id, userId: linkToOidcConfirm.userId });
              }}
            >
              {linkToOidcMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Linking...
                </>
              ) : (
                "Link to SSO"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removeMember} onOpenChange={(open) => !open && setRemoveMember(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove team member?</DialogTitle>
            <DialogDescription>
              This will remove <span className="font-medium">{removeMember?.name}</span> from the team. They will lose access to all environments and pipelines.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveMember(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removeMemberMutation.isPending}
              onClick={() => {
                if (!removeMember) return;
                removeMemberMutation.mutate(
                  { teamId: team.id, userId: removeMember.userId },
                  { onSuccess: () => setRemoveMember(null) },
                );
              }}
            >
              {removeMemberMutation.isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Add Member</CardTitle>
          <CardDescription>
            Add an existing user to the team by their email address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="grid grid-cols-[1fr_120px_auto] items-end gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(val: "VIEWER" | "EDITOR" | "ADMIN") =>
                  setInviteRole(val)
                }
              >
                <SelectTrigger id="invite-role" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                  <SelectItem value="EDITOR">Editor</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="h-9" disabled={addMemberMutation.isPending}>
              {addMemberMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Classification Tags</CardTitle>
          <CardDescription>
            Define classification tags that can be applied to pipelines in this team (e.g., PII, PHI, PCI-DSS).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {availableTags.length === 0 && (
              <span className="text-sm text-muted-foreground">No tags defined yet.</span>
            )}
            {availableTags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-sm gap-1.5">
                {tag}
                <button
                  type="button"
                  className="inline-flex items-center rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                  onClick={() => handleRemoveTag(tag)}
                  disabled={updateTagsMutation.isPending}
                  aria-label={`Remove ${tag} tag`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <form onSubmit={handleAddTag} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="new-tag">Add Tag</Label>
              <Input
                id="new-tag"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="e.g., PII, Internal, PCI-DSS"
                maxLength={30}
              />
            </div>
            <Button type="submit" className="h-9" disabled={updateTagsMutation.isPending || !newTag.trim()}>
              {updateTagsMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Users Tab (Super Admin) ────────────────────────────────────────────────────

function UsersSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const usersQuery = useQuery(trpc.admin.listUsers.queryOptions());
  const teamsQuery = useQuery(trpc.admin.listTeams.queryOptions());

  const [assignDialog, setAssignDialog] = useState<{ userId: string; userName: string } | null>(null);
  const [assignTeamId, setAssignTeamId] = useState("");
  const [assignRole, setAssignRole] = useState<"VIEWER" | "EDITOR" | "ADMIN">("VIEWER");
  const [deleteDialog, setDeleteDialog] = useState<{ userId: string; userName: string } | null>(null);
  const [removeFromTeamConfirm, setRemoveFromTeamConfirm] = useState<{ userId: string; userName: string; teamId: string; teamName: string } | null>(null);
  const [toggleSuperAdminConfirm, setToggleSuperAdminConfirm] = useState<{ userId: string; userName: string; isSuperAdmin: boolean } | null>(null);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserTeamId, setNewUserTeamId] = useState("");
  const [newUserRole, setNewUserRole] = useState<"VIEWER" | "EDITOR" | "ADMIN">("VIEWER");
  const [showCreatedPassword, setShowCreatedPassword] = useState(false);
  const [createdPassword, setCreatedPassword] = useState("");

  const assignMutation = useMutation(
    trpc.admin.assignToTeam.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
        toast.success("User assigned to team");
        setAssignDialog(null);
        setAssignTeamId("");
        setAssignRole("VIEWER");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to assign user to team");
      },
    })
  );

  const toggleSuperAdminMutation = useMutation(
    trpc.admin.toggleSuperAdmin.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
        toast.success(
          data.isSuperAdmin ? "User promoted to super admin" : "Super admin status removed"
        );
        setToggleSuperAdminConfirm(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to toggle super admin status");
      },
    })
  );

  const deleteUserMutation = useMutation(
    trpc.admin.deleteUser.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
        toast.success("User deleted");
        setDeleteDialog(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete user");
      },
    })
  );

  const createUserMutation = useMutation(
    trpc.admin.createUser.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
        toast.success("User created");
        setCreatedPassword(data.generatedPassword);
        setShowCreatedPassword(true);
        setCreateUserOpen(false);
        setNewUserEmail("");
        setNewUserName("");
        setNewUserTeamId("");
        setNewUserRole("VIEWER");
      },
      onError: (error) => toast.error(error.message),
    })
  );

  const removeFromTeamMutation = useMutation(
    trpc.admin.removeFromTeam.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
        toast.success("User removed from team");
        setRemoveFromTeamConfirm(null);
      },
      onError: (error) => toast.error(error.message),
    })
  );

  const lockUserMutation = useMutation(
    trpc.admin.lockUser.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
        toast.success("User locked");
      },
      onError: (error) => toast.error(error.message),
    })
  );

  const unlockUserMutation = useMutation(
    trpc.admin.unlockUser.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
        toast.success("User unlocked");
      },
      onError: (error) => toast.error(error.message),
    })
  );

  const [resetPasswordDialog, setResetPasswordDialog] = useState<{ userId: string; userName: string } | null>(null);
  const [resetPasswordResult, setResetPasswordResult] = useState("");
  const [lockDialog, setLockDialog] = useState<{ userId: string; userName: string; action: "lock" | "unlock" } | null>(null);

  const resetPasswordMutation = useMutation(
    trpc.admin.resetPassword.mutationOptions({
      onSuccess: (data) => {
        setResetPasswordResult(data.temporaryPassword);
      },
      onError: (error) => toast.error(error.message),
    })
  );

  if (usersQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const users = usersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Platform Users</CardTitle>
            <CardDescription>Manage all users across the platform.</CardDescription>
          </div>
          <Button onClick={() => setCreateUserOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create User
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Auth Method</TableHead>
                <TableHead>Teams</TableHead>
                <TableHead>Super Admin</TableHead>
                <TableHead>2FA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[180px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {user.name || "Unnamed"}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    {user.authMethod === "LOCAL" && (
                      <Badge variant="outline">Local</Badge>
                    )}
                    {user.authMethod === "OIDC" && (
                      <Badge variant="secondary">SSO</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {user.memberships.length === 0 && (
                        <span className="text-xs text-muted-foreground">No teams</span>
                      )}
                      {user.memberships.length > 0 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="flex items-center gap-1 rounded-md hover:bg-muted/50 px-1 py-0.5 transition-colors">
                              {user.memberships.slice(0, 2).map((m) => (
                                <Badge key={m.team.id} variant="outline" className="text-xs">
                                  {m.team.name}
                                </Badge>
                              ))}
                              {user.memberships.length > 2 && (
                                <span className="text-xs text-muted-foreground">
                                  +{user.memberships.length - 2} more
                                </span>
                              )}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-3" align="start">
                            <p className="mb-2 text-sm font-medium">Team Memberships</p>
                            <div className="space-y-2">
                              {user.memberships.map((m) => (
                                <div key={m.team.id} className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">{m.team.name}</Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {m.role.charAt(0) + m.role.slice(1).toLowerCase()}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="rounded-full hover:bg-muted p-0.5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRemoveFromTeamConfirm({ userId: user.id, userName: user.name ?? user.email, teamId: m.team.id, teamName: m.team.name });
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.isSuperAdmin ? (
                      <Badge className="text-xs">
                        <Crown className="mr-1 h-3 w-3" />
                        Yes
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.totpEnabled ? (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                        <Shield className="mr-1 h-3 w-3" />
                        Enabled
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.lockedAt ? (
                      <Badge variant="destructive" className="text-xs">
                        <Lock className="mr-1 h-3 w-3" />
                        Locked
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                        Active
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Assign to team"
                        aria-label="Assign to team"
                        onClick={() =>
                          setAssignDialog({
                            userId: user.id,
                            userName: user.name || user.email,
                          })
                        }
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={user.lockedAt ? "Unlock user" : "Lock user"}
                        aria-label={user.lockedAt ? "Unlock user" : "Lock user"}
                        onClick={() =>
                          setLockDialog({
                            userId: user.id,
                            userName: user.name || user.email,
                            action: user.lockedAt ? "unlock" : "lock",
                          })
                        }
                      >
                        {user.lockedAt ? (
                          <Unlock className="h-4 w-4" />
                        ) : (
                          <Lock className="h-4 w-4" />
                        )}
                      </Button>
                      {user.authMethod !== "OIDC" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Reset password"
                          aria-label="Reset password"
                          onClick={() =>
                            setResetPasswordDialog({
                              userId: user.id,
                              userName: user.name || user.email,
                            })
                          }
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={user.isSuperAdmin ? "Remove super admin" : "Make super admin"}
                        aria-label={user.isSuperAdmin ? "Remove super admin" : "Make super admin"}
                        disabled={toggleSuperAdminMutation.isPending}
                        onClick={() =>
                          setToggleSuperAdminConfirm({
                            userId: user.id,
                            userName: user.name ?? user.email,
                            isSuperAdmin: !user.isSuperAdmin,
                          })
                        }
                      >
                        <Shield className={`h-4 w-4 ${user.isSuperAdmin ? "text-primary" : ""}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Delete user"
                        aria-label="Delete user"
                        onClick={() =>
                          setDeleteDialog({
                            userId: user.id,
                            userName: user.name || user.email,
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Assign to Team Dialog */}
      <Dialog open={!!assignDialog} onOpenChange={(open) => {
        if (!open) {
          setAssignDialog(null);
          setAssignTeamId("");
          setAssignRole("VIEWER");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign to Team</DialogTitle>
            <DialogDescription>
              Assign <span className="font-medium">{assignDialog?.userName}</span> to a team with a specific role.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="assign-team">Team</Label>
              <Select value={assignTeamId} onValueChange={setAssignTeamId}>
                <SelectTrigger id="assign-team" className="w-full">
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {(teamsQuery.data ?? []).map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assign-role">Role</Label>
              <Select
                value={assignRole}
                onValueChange={(val: "VIEWER" | "EDITOR" | "ADMIN") => setAssignRole(val)}
              >
                <SelectTrigger id="assign-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                  <SelectItem value="EDITOR">Editor</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAssignDialog(null);
                setAssignTeamId("");
                setAssignRole("VIEWER");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={assignMutation.isPending || !assignTeamId}
              onClick={() => {
                if (!assignDialog) return;
                assignMutation.mutate({
                  userId: assignDialog.userId,
                  teamId: assignTeamId,
                  role: assignRole,
                });
              }}
            >
              {assignMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Assigning...
                </>
              ) : (
                "Assign"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lock/Unlock Confirmation Dialog */}
      <Dialog open={!!lockDialog} onOpenChange={(open) => !open && setLockDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lockDialog?.action === "lock" ? "Lock user?" : "Unlock user?"}</DialogTitle>
            <DialogDescription>
              {lockDialog?.action === "lock"
                ? <><span className="font-medium">{lockDialog?.userName}</span> will be unable to log in until unlocked.</>
                : <><span className="font-medium">{lockDialog?.userName}</span> will be able to log in again.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={lockDialog?.action === "lock" ? "destructive" : "default"}
              disabled={lockUserMutation.isPending || unlockUserMutation.isPending}
              onClick={() => {
                if (!lockDialog) return;
                if (lockDialog.action === "lock") {
                  lockUserMutation.mutate({ userId: lockDialog.userId }, { onSuccess: () => setLockDialog(null) });
                } else {
                  unlockUserMutation.mutate({ userId: lockDialog.userId }, { onSuccess: () => setLockDialog(null) });
                }
              }}
            >
              {lockDialog?.action === "lock" ? "Lock" : "Unlock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={(open) => !open && setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              This will permanently delete <span className="font-medium">{deleteDialog?.userName}</span> and all their data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteUserMutation.isPending}
              onClick={() => {
                if (!deleteDialog) return;
                deleteUserMutation.mutate({ userId: deleteDialog.userId });
              }}
            >
              {deleteUserMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete User"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog open={createUserOpen} onOpenChange={(open) => {
        setCreateUserOpen(open);
        if (!open) {
          setNewUserEmail("");
          setNewUserName("");
          setNewUserTeamId("");
          setNewUserRole("VIEWER");
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>
              Create a new local user account.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            createUserMutation.mutate({
              email: newUserEmail,
              name: newUserName,
              ...(newUserTeamId ? { teamId: newUserTeamId, role: newUserRole } : {}),
            });
          }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="user@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-name">Name</Label>
              <Input
                id="new-user-name"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Full name"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-user-team">Team (optional)</Label>
                <Select value={newUserTeamId} onValueChange={setNewUserTeamId}>
                  <SelectTrigger id="new-user-team">
                    <SelectValue placeholder="No team" />
                  </SelectTrigger>
                  <SelectContent>
                    {(teamsQuery?.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-user-role">Role</Label>
                <Select value={newUserRole} onValueChange={(val: "VIEWER" | "EDITOR" | "ADMIN") => setNewUserRole(val)}>
                  <SelectTrigger id="new-user-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VIEWER">Viewer</SelectItem>
                    <SelectItem value="EDITOR">Editor</SelectItem>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateUserOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createUserMutation.isPending}>
                {createUserMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create User"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset Password Confirmation Dialog */}
      <Dialog open={!!resetPasswordDialog} onOpenChange={(open) => {
        if (!open) {
          if (resetPasswordResult) {
            queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
          }
          setResetPasswordDialog(null);
          setResetPasswordResult("");
        }
      }}>
        <DialogContent className="sm:max-w-md">
          {resetPasswordResult ? (
            <>
              <DialogHeader>
                <DialogTitle>Temporary Password</DialogTitle>
                <DialogDescription>
                  Share this temporary password with the user. They will be required to change it on first login.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <Input value={resetPasswordResult} readOnly className="font-mono" aria-label="Temporary password" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy temporary password"
                  onClick={async () => {
                    await copyToClipboard(resetPasswordResult);
                    toast.success("Copied to clipboard");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => {
                  queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
                  setResetPasswordDialog(null);
                  setResetPasswordResult("");
                }}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Reset password?</DialogTitle>
                <DialogDescription>
                  This will generate a new temporary password for <span className="font-medium">{resetPasswordDialog?.userName}</span>. They will be required to change it on next login.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResetPasswordDialog(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={resetPasswordMutation.isPending}
                  onClick={() => {
                    if (!resetPasswordDialog) return;
                    resetPasswordMutation.mutate({ userId: resetPasswordDialog.userId });
                  }}
                >
                  {resetPasswordMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Password Display Dialog */}
      <Dialog open={showCreatedPassword} onOpenChange={setShowCreatedPassword}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>User Created</DialogTitle>
            <DialogDescription>
              Share this password with the user. It will only be shown once.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input value={createdPassword} readOnly className="font-mono" aria-label="Generated password" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy password"
              onClick={async () => {
                await copyToClipboard(createdPassword);
                toast.success("Copied to clipboard");
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => {
              setShowCreatedPassword(false);
              setCreatedPassword("");
            }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove from team confirmation */}
      <ConfirmDialog
        open={!!removeFromTeamConfirm}
        onOpenChange={(open) => !open && setRemoveFromTeamConfirm(null)}
        title="Remove from team?"
        description={<>Remove <span className="font-medium">{removeFromTeamConfirm?.userName}</span> from <span className="font-medium">{removeFromTeamConfirm?.teamName}</span>? They will lose access to all environments and pipelines in this team.</>}
        confirmLabel="Remove"
        isPending={removeFromTeamMutation.isPending}
        pendingLabel="Removing..."
        onConfirm={() => {
          if (!removeFromTeamConfirm) return;
          removeFromTeamMutation.mutate({ userId: removeFromTeamConfirm.userId, teamId: removeFromTeamConfirm.teamId });
        }}
      />

      {/* Toggle super admin confirmation */}
      <ConfirmDialog
        open={!!toggleSuperAdminConfirm}
        onOpenChange={(open) => !open && setToggleSuperAdminConfirm(null)}
        title={toggleSuperAdminConfirm?.isSuperAdmin ? "Grant super admin?" : "Remove super admin?"}
        description={toggleSuperAdminConfirm?.isSuperAdmin
          ? <><span className="font-medium">{toggleSuperAdminConfirm?.userName}</span> will get full platform access including all teams, user management, and system settings.</>
          : <><span className="font-medium">{toggleSuperAdminConfirm?.userName}</span> will lose platform-wide admin access and only see teams they are a member of.</>
        }
        confirmLabel={toggleSuperAdminConfirm?.isSuperAdmin ? "Grant" : "Remove"}
        variant={toggleSuperAdminConfirm?.isSuperAdmin ? "default" : "destructive"}
        isPending={toggleSuperAdminMutation.isPending}
        onConfirm={() => {
          if (!toggleSuperAdminConfirm) return;
          toggleSuperAdminMutation.mutate({ userId: toggleSuperAdminConfirm.userId, isSuperAdmin: toggleSuperAdminConfirm.isSuperAdmin });
        }}
      />
    </div>
  );
}

// ─── Teams Management (Super Admin) ─────────────────────────────────────────────

function TeamsManagement() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const teamsQuery = useQuery(trpc.team.list.queryOptions());

  const createMutation = useMutation(
    trpc.team.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.list.queryKey() });
        toast.success("Team created");
        setCreateOpen(false);
        setNewTeamName("");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create team");
      },
    })
  );

  const deleteMutation = useMutation(
    trpc.team.delete.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: trpc.team.list.queryKey() });
        toast.success("Team deleted");
        const selectedTeamId = useTeamStore.getState().selectedTeamId;
        if (selectedTeamId === variables.teamId) {
          useTeamStore.getState().setSelectedTeamId(null);
        }
        setDeleteTeam(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete team");
      },
    })
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [deleteTeam, setDeleteTeam] = useState<{ id: string; name: string } | null>(null);

  if (teamsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const teams = teamsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Teams</CardTitle>
              <CardDescription>
                Manage all teams on the platform. Create new teams or remove unused ones.
              </CardDescription>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Team
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Environments</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell className="font-medium">{team.name}</TableCell>
                  <TableCell>{team._count.members}</TableCell>
                  <TableCell>{team._count.environments}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(team.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title={
                        team._count.environments > 0
                          ? "Remove environments before deleting"
                          : "Delete team"
                      }
                      aria-label="Delete team"
                      disabled={team._count.environments > 0}
                      onClick={() =>
                        setDeleteTeam({ id: team.id, name: team.name })
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Team Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Team</DialogTitle>
            <DialogDescription>
              Create a new team. You will be added as an admin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-team-name">Name</Label>
              <Input
                id="new-team-name"
                placeholder="Team name"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={createMutation.isPending || !newTeamName.trim()}
              onClick={() => createMutation.mutate({ name: newTeamName.trim() })}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Team Confirmation Dialog */}
      <Dialog open={!!deleteTeam} onOpenChange={(open) => !open && setDeleteTeam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete team?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-medium">{deleteTeam?.name}</span>? This will permanently delete the team, its members, and templates. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTeam(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!deleteTeam) return;
                deleteMutation.mutate({ teamId: deleteTeam.id });
              }}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Backup Settings ────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BackupSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const backupsQuery = useQuery(trpc.settings.listBackups.queryOptions());

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleCron, setScheduleCron] = useState("0 2 * * *");
  const [retentionCount, setRetentionCount] = useState(7);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    if (settingsQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScheduleEnabled(settingsQuery.data.backupEnabled ?? false);
      setScheduleCron(settingsQuery.data.backupCron ?? "0 2 * * *");
      setRetentionCount(settingsQuery.data.backupRetentionCount ?? 7);
    }
  }, [settingsQuery.data]);

  const createBackupMutation = useMutation(
    trpc.settings.createBackup.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.listBackups.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("Backup created successfully");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create backup");
      },
    }),
  );

  const deleteBackupMutation = useMutation(
    trpc.settings.deleteBackup.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.listBackups.queryKey() });
        setDeleteTarget(null);
        toast.success("Backup deleted");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete backup");
      },
    }),
  );

  const restoreBackupMutation = useMutation(
    trpc.settings.restoreBackup.mutationOptions({
      onSuccess: () => {
        setRestoreTarget(null);
        toast.success("Backup restored successfully. Please restart the application.");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to restore backup");
      },
    }),
  );

  const updateScheduleMutation = useMutation(
    trpc.settings.updateBackupSchedule.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("Backup schedule updated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update backup schedule");
      },
    }),
  );

  return (
    <div className="space-y-6">
      {/* Backup Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Backup Schedule
          </CardTitle>
          <CardDescription>
            Configure automatic database backups on a schedule.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="backup-schedule-toggle">Enable scheduled backups</Label>
            <Switch
              id="backup-schedule-toggle"
              checked={scheduleEnabled}
              onCheckedChange={setScheduleEnabled}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Schedule</Label>
              <Select value={scheduleCron} onValueChange={setScheduleCron}>
                <SelectTrigger>
                  <SelectValue placeholder="Select schedule" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0 */12 * * *">Every 12 hours</SelectItem>
                  <SelectItem value="0 2 * * *">Daily at 2:00 AM</SelectItem>
                  <SelectItem value="0 2 * * 0">Weekly (Sunday 2:00 AM)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Retention (keep last N backups)</Label>
              <Select
                value={String(retentionCount)}
                onValueChange={(v) => setRetentionCount(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select retention" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="7">7</SelectItem>
                  <SelectItem value="14">14</SelectItem>
                  <SelectItem value="30">30</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={() =>
              updateScheduleMutation.mutate({
                enabled: scheduleEnabled,
                cron: scheduleCron,
                retentionCount,
              })
            }
            disabled={updateScheduleMutation.isPending}
          >
            {updateScheduleMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save Schedule
          </Button>
        </CardContent>
      </Card>

      {/* Manual Backup */}
      <Card>
        <CardHeader>
          <CardTitle>Manual Backup</CardTitle>
          <CardDescription>
            Create an on-demand backup of the database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => createBackupMutation.mutate()}
            disabled={createBackupMutation.isPending}
          >
            {createBackupMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Create Backup Now
          </Button>
          {settingsQuery.data?.lastBackupAt && (
            <p className="text-sm text-muted-foreground">
              Last backup: {formatRelativeTime(settingsQuery.data.lastBackupAt)}
              {settingsQuery.data.lastBackupStatus && (
                <> &mdash; {settingsQuery.data.lastBackupStatus}</>
              )}
              {settingsQuery.data.lastBackupError && (
                <span className="text-destructive"> ({settingsQuery.data.lastBackupError})</span>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Available Backups */}
      <Card>
        <CardHeader>
          <CardTitle>Available Backups</CardTitle>
          <CardDescription>
            Manage existing database backups. You can restore or delete them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {backupsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : !backupsQuery.data?.length ? (
            <p className="text-sm text-muted-foreground">No backups found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Migrations</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backupsQuery.data.map((backup) => (
                  <TableRow key={backup.filename}>
                    <TableCell>
                      {new Date(backup.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>{formatBytes(backup.sizeBytes)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{backup.version}</Badge>
                    </TableCell>
                    <TableCell>{backup.migrationCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRestoreTarget(backup.filename)}
                        >
                          Restore
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(backup.filename)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Warning Banner */}
      <Card className="border-yellow-500/50">
        <CardContent className="flex items-start gap-3 pt-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-500" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Important</p>
            <p>
              Database backups do not include your <code>.env</code> file or
              encryption secrets. Make sure to keep those backed up separately in
              a secure location.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Restore Confirmation Dialog */}
      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        title="Restore from backup?"
        description="This will overwrite the current database with the selected backup. This action cannot be undone. The application should be restarted after restoring."
        confirmLabel="Restore"
        variant="destructive"
        isPending={restoreBackupMutation.isPending}
        onConfirm={() => {
          if (restoreTarget) {
            restoreBackupMutation.mutate({ filename: restoreTarget });
          }
        }}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete backup?"
        description="This will permanently delete the selected backup file. This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteBackupMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteBackupMutation.mutate({ filename: deleteTarget });
          }
        }}
      />
    </div>
  );
}

// ─── Main Settings Page ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const trpc = useTRPC();

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const teamRoleQuery = useQuery(
    trpc.team.teamRole.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );
  const isSuperAdmin = teamRoleQuery.data?.isSuperAdmin ?? false;
  const isTeamAdmin = teamRoleQuery.data?.role === "ADMIN";

  if (teamRoleQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue={isTeamAdmin ? "team" : isSuperAdmin ? "auth" : "team"}>
        <TabsList>
          {isTeamAdmin && (
            <TabsTrigger value="team">
              <Users className="mr-2 h-4 w-4" />
              Team
            </TabsTrigger>
          )}
          {isSuperAdmin && (
            <>
              <TabsTrigger value="auth">
                <Shield className="mr-2 h-4 w-4" />
                Auth
              </TabsTrigger>
              <TabsTrigger value="fleet">
                <Server className="mr-2 h-4 w-4" />
                Fleet
              </TabsTrigger>
              <TabsTrigger value="users">
                <Users className="mr-2 h-4 w-4" />
                Users
              </TabsTrigger>
              <TabsTrigger value="teams">
                <Layers className="mr-2 h-4 w-4" />
                Teams
              </TabsTrigger>
              <TabsTrigger value="version">
                <RefreshCw className="mr-2 h-4 w-4" />
                Version
              </TabsTrigger>
              <TabsTrigger value="audit-shipping">
                <ExternalLink className="mr-2 h-4 w-4" />
                Audit Shipping
              </TabsTrigger>
              <TabsTrigger value="backup">
                <HardDrive className="mr-2 h-4 w-4" />
                Backup
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {isTeamAdmin && (
          <TabsContent value="team" className="mt-6">
            <TeamSettings />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <>
            <TabsContent value="auth" className="mt-6">
              <AuthSettings />
            </TabsContent>
            <TabsContent value="fleet" className="mt-6">
              <FleetSettings />
            </TabsContent>
            <TabsContent value="users" className="mt-6">
              <UsersSettings />
            </TabsContent>
            <TabsContent value="teams" className="mt-6">
              <TeamsManagement />
            </TabsContent>
            <TabsContent value="version" className="mt-6">
              <VersionCheckSection />
            </TabsContent>
            <TabsContent value="audit-shipping" className="mt-6">
              <AuditLogShippingSection />
            </TabsContent>
            <TabsContent value="backup" className="mt-6">
              <BackupSettings />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
