"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

  const [defaultRole, setDefaultRole] = useState<"VIEWER" | "EDITOR" | "ADMIN">("VIEWER");
  const [groupsClaim, setGroupsClaim] = useState("groups");
  const [adminGroups, setAdminGroups] = useState("");
  const [editorGroups, setEditorGroups] = useState("");

  useEffect(() => {
    if (settings) {
      setDefaultRole((settings.oidcDefaultRole as "VIEWER" | "EDITOR" | "ADMIN") ?? "VIEWER");
      setGroupsClaim(settings.oidcGroupsClaim ?? "groups");
      setAdminGroups(settings.oidcAdminGroups ?? "");
      setEditorGroups(settings.oidcEditorGroups ?? "");
    }
  }, [settings]);

  const updateRoleMappingMutation = useMutation(
    trpc.settings.updateOidcRoleMapping.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("OIDC role mapping saved");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save role mapping");
      },
    })
  );

  const handleSaveRoleMapping = (e: React.FormEvent) => {
    e.preventDefault();
    updateRoleMappingMutation.mutate({
      defaultRole,
      groupsClaim,
      adminGroups: adminGroups || undefined,
      editorGroups: editorGroups || undefined,
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
        <CardTitle>OIDC Role Mapping</CardTitle>
        <CardDescription>
          Map OIDC groups to VectorFlow roles. When a user signs in via SSO,
          their role is determined by their group membership.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSaveRoleMapping} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="oidc-default-role">Default Role</Label>
            <Select
              value={defaultRole}
              onValueChange={(val: "VIEWER" | "EDITOR" | "ADMIN") => setDefaultRole(val)}
            >
              <SelectTrigger id="oidc-default-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VIEWER">Viewer</SelectItem>
                <SelectItem value="EDITOR">Editor</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Role assigned to SSO users who don&apos;t match any group mapping
            </p>
          </div>

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
              The OIDC token claim that contains group names (usually
              &quot;groups&quot;)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidc-admin-groups">Admin Groups</Label>
            <Input
              id="oidc-admin-groups"
              placeholder="vectorflow-admins, platform-admins"
              value={adminGroups}
              onChange={(e) => setAdminGroups(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated group names that grant Admin role
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidc-editor-groups">Editor Groups</Label>
            <Input
              id="oidc-editor-groups"
              placeholder="vectorflow-editors, developers"
              value={editorGroups}
              onChange={(e) => setEditorGroups(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated group names that grant Editor role
            </p>
          </div>

          <Button
            type="submit"
            disabled={updateRoleMappingMutation.isPending}
          >
            {updateRoleMappingMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Role Mapping"
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

  useEffect(() => {
    if (settings) {
      setPollIntervalSec(Math.round(settings.fleetPollIntervalMs / 1000));
      setUnhealthyThreshold(settings.fleetUnhealthyThreshold);
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
        toast.success("Member invited successfully");
        setInviteEmail("");
        setInviteRole("VIEWER");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to invite member");
      },
    })
  );

  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
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
                      {member.user.authMethod === "BOTH" && (
                        <Badge variant="secondary">SSO + Local</Badge>
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
                    {member.user.lockedAt && (
                      <Badge variant="destructive" className="text-xs">Locked</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {member.user.lockedAt ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => unlockMutation.mutate({ teamId: team.id, userId: member.user.id })}
                          disabled={unlockMutation.isPending}
                        >
                          <Unlock className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => lockMutation.mutate({ teamId: team.id, userId: member.user.id })}
                          disabled={lockMutation.isPending}
                        >
                          <Lock className="h-4 w-4" />
                        </Button>
                      )}
                      {member.user.authMethod !== "OIDC" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => resetPasswordMutation.mutate({ teamId: team.id, userId: member.user.id })}
                          disabled={resetPasswordMutation.isPending}
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

      <Dialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Temporary Password</DialogTitle>
            <DialogDescription>
              Share this temporary password with the user. It will only be shown once.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input value={tempPassword} readOnly className="font-mono" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(tempPassword);
                toast.success("Copied to clipboard");
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setResetPasswordOpen(false)}>Done</Button>
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
          <CardTitle>Invite Member</CardTitle>
          <CardDescription>
            Add a new member to the team by their email address.
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
                  Inviting...
                </>
              ) : (
                "Invite"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
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
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-muted-foreground">Users management coming soon</p>
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
