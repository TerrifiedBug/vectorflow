"use client";

import { useState, useEffect } from "react";
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


// ─── Auth Tab ──────────────────────────────────────────────────────────────────

function AuthSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const settings = settingsQuery.data;

  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [displayName, setDisplayName] = useState("SSO");
  const [tokenAuthMethod, setTokenAuthMethod] = useState<"client_secret_post" | "client_secret_basic">("client_secret_post");

  useEffect(() => {
    if (settings) {
      setIssuer(settings.oidcIssuer ?? "");
      setClientId(settings.oidcClientId ?? "");
      setDisplayName(settings.oidcDisplayName ?? "SSO");
      setTokenAuthMethod((settings.oidcTokenEndpointAuthMethod as "client_secret_post" | "client_secret_basic") ?? "client_secret_post");
      // Don't populate clientSecret - it's masked
    }
  }, [settings]);

  const updateOidcMutation = useMutation(
    trpc.settings.updateOidc.mutationOptions({
      onSuccess: () => {
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
  const [groupsClaim, setGroupsClaim] = useState("groups");

  const teamsQuery = useQuery(trpc.admin.listTeams.queryOptions());

  useEffect(() => {
    if (settings) {
      setDefaultRole((settings.oidcDefaultRole as "VIEWER" | "EDITOR" | "ADMIN") ?? "VIEWER");
      setGroupsClaim(settings.oidcGroupsClaim ?? "groups");
      setTeamMappings((settings.oidcTeamMappings ?? []) as Array<{group: string; teamId: string; role: "VIEWER" | "EDITOR" | "ADMIN"}>);
      setDefaultTeamId(settings.oidcDefaultTeamId ?? "");
    }
  }, [settings]);

  const updateTeamMappingMutation = useMutation(
    trpc.settings.updateOidcTeamMappings.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("OIDC team mapping saved");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save team mapping");
      },
    })
  );

  function addMapping() {
    setTeamMappings([...teamMappings, { group: "", teamId: "", role: "VIEWER" }]);
  }

  function removeMapping(index: number) {
    setTeamMappings(teamMappings.filter((_, i) => i !== index));
  }

  function updateMapping(index: number, field: keyof typeof teamMappings[number], value: string) {
    setTeamMappings(teamMappings.map((m, i) =>
      i === index ? { ...m, [field]: value } as typeof m : m
    ));
  }

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
              onChange={(e) => setIssuer(e.target.value)}
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
              onChange={(e) => setClientId(e.target.value)}
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
              onChange={(e) => setClientSecret(e.target.value)}
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
              onChange={(e) => setDisplayName(e.target.value)}
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
              onValueChange={(val: "client_secret_post" | "client_secret_basic") => setTokenAuthMethod(val)}
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
            groupsClaim,
          });
        }} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="oidc-groups-claim">Groups Claim</Label>
            <Input
              id="oidc-groups-claim"
              placeholder="groups"
              value={groupsClaim}
              onChange={(e) => setGroupsClaim(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              The OIDC token claim that contains group names (usually &quot;groups&quot;)
            </p>
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
              <Select value={defaultTeamId} onValueChange={setDefaultTeamId}>
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
                onValueChange={(val: "VIEWER" | "EDITOR" | "ADMIN") => setDefaultRole(val)}
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

  useEffect(() => {
    if (settings) {
      setPollIntervalSec(Math.round(settings.fleetPollIntervalMs / 1000));
      setUnhealthyThreshold(settings.fleetUnhealthyThreshold);
      if (settings.metricsRetentionDays) setMetricsRetentionDays(settings.metricsRetentionDays);
    }
  }, [settings]);

  const updateFleetMutation = useMutation(
    trpc.settings.updateFleet.mutationOptions({
      onSuccess: () => {
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
              onChange={(e) => setPollIntervalSec(Number(e.target.value))}
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
              onChange={(e) => setUnhealthyThreshold(Number(e.target.value))}
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
              onChange={(e) => setMetricsRetentionDays(Number(e.target.value))}
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

  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState<{ userId: string; name: string } | null>(null);
  const [lockConfirm, setLockConfirm] = useState<{ userId: string; name: string; action: "lock" | "unlock" } | null>(null);
  const [removeMember, setRemoveMember] = useState<{ userId: string; name: string } | null>(null);

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

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeamId || !teamName.trim()) return;
    renameMutation.mutate({ teamId: selectedTeamId, name: teamName.trim() });
  };

  // Sync team name state when data loads
  useEffect(() => {
    if (team?.name && !teamName) setTeamName(team.name);
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
                          onClick={() => setResetPasswordConfirm({ userId: member.user.id, name: member.user.name || member.user.email })}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
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
                <Input value={tempPassword} readOnly className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    copyToClipboard(tempPassword);
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
          <form onSubmit={handleInvite} className="flex items-end gap-3">
            <div className="min-w-0 flex-1 space-y-2">
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
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(val: "VIEWER" | "EDITOR" | "ADMIN") =>
                  setInviteRole(val)
                }
              >
                <SelectTrigger id="invite-role" className="h-9 w-[120px]">
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
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
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
                    <div className="flex flex-wrap gap-1">
                      {user.memberships.length === 0 && (
                        <span className="text-xs text-muted-foreground">No teams</span>
                      )}
                      {user.memberships.map((m) => (
                        <Badge key={m.team.id} variant="outline" className="text-xs flex items-center gap-1">
                          {m.team.name} ({m.role.charAt(0) + m.role.slice(1).toLowerCase()})
                          <button
                            type="button"
                            className="ml-0.5 rounded-full hover:bg-muted p-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRemoveFromTeamConfirm({ userId: user.id, userName: user.name ?? user.email, teamId: m.team.id, teamName: m.team.name });
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
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
                <Input value={resetPasswordResult} readOnly className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    copyToClipboard(resetPasswordResult);
                    toast.success("Copied to clipboard");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => {
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
            <Input value={createdPassword} readOnly className="font-mono" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                copyToClipboard(createdPassword);
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

  const meQuery = useQuery(trpc.user.me.queryOptions());
  const me = meQuery.data;

  if (teamRoleQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
          <p className="text-muted-foreground">
            Manage system configuration and team settings
          </p>
        </div>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Manage system configuration and team settings
        </p>
      </div>


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
          </>
        )}
      </Tabs>
    </div>
  );
}
