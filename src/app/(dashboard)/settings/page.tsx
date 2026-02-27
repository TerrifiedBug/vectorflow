"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  Shield,
  Server,
  GitBranch,
  Users,
  Loader2,
  CheckCircle2,
  XCircle,
  Upload,
  KeyRound,
  Trash2,
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

  useEffect(() => {
    if (settings) {
      setIssuer(settings.oidcIssuer ?? "");
      setClientId(settings.oidcClientId ?? "");
      setDisplayName(settings.oidcDisplayName ?? "SSO");
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
    });
  };

  const handleTest = () => {
    if (!issuer) {
      toast.error("Please enter an issuer URL first");
      return;
    }
    testOidcMutation.mutate({ issuer });
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

// ─── GitOps Tab ────────────────────────────────────────────────────────────────

function GitOpsSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const settings = settingsQuery.data;

  const [commitAuthor, setCommitAuthor] = useState("");

  useEffect(() => {
    if (settings) {
      setCommitAuthor(settings.gitopsCommitAuthor ?? "");
    }
  }, [settings]);

  const updateGitopsMutation = useMutation(
    trpc.settings.updateGitops.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("GitOps settings saved successfully");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save GitOps settings");
      },
    })
  );

  const uploadSshKeyMutation = useMutation(
    trpc.settings.uploadSshKey.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("SSH key uploaded successfully");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      },
      onError: (error) => {
        toast.error(error.message || "Failed to upload SSH key");
      },
    })
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateGitopsMutation.mutate({ commitAuthor });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Convert to base64
      const base64 = btoa(result);
      uploadSshKeyMutation.mutate({ keyBase64: base64 });
    };
    reader.readAsText(file);
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
          <CardTitle>GitOps Configuration</CardTitle>
          <CardDescription>
            Configure how VectorFlow commits pipeline configurations to Git
            repositories.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="commit-author">Commit Author</Label>
              <Input
                id="commit-author"
                placeholder="VectorFlow <vectorflow@company.com>"
                value={commitAuthor}
                onChange={(e) => setCommitAuthor(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Git author string used for automated commits (format: Name
                &lt;email&gt;)
              </p>
            </div>

            <Button type="submit" disabled={updateGitopsMutation.isPending}>
              {updateGitopsMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save GitOps Settings"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SSH Key</CardTitle>
          <CardDescription>
            Upload a private SSH key for Git repository authentication. The key
            is encrypted at rest.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings?.hasSshKey && (
            <div className="flex items-center gap-2 rounded-md border p-3">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-sm">
                {settings.sshKeyFingerprint ?? "Key uploaded"}
              </span>
              <Badge variant="secondary" className="ml-auto">
                Configured
              </Badge>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="ssh-key-upload">
              {settings?.hasSshKey ? "Replace SSH Key" : "Upload SSH Key"}
            </Label>
            <div className="flex items-center gap-3">
              <Input
                ref={fileInputRef}
                id="ssh-key-upload"
                type="file"
                accept=".pem,.key,id_rsa,id_ed25519"
                onChange={handleFileUpload}
                className="max-w-sm"
              />
              {uploadSshKeyMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Accepted formats: PEM, OpenSSH private key
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Team Tab ──────────────────────────────────────────────────────────────────

function TeamSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const teamsQuery = useQuery(trpc.team.list.queryOptions());
  const firstTeamId = teamsQuery.data?.[0]?.id;

  const teamQuery = useQuery(
    trpc.team.get.queryOptions(
      { id: firstTeamId! },
      { enabled: !!firstTeamId }
    )
  );

  const team = teamQuery.data;

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

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstTeamId || !inviteEmail) return;
    // For now, we pass the email as userId - in a real system, you'd look up the user first
    addMemberMutation.mutate({
      teamId: firstTeamId,
      userId: inviteEmail,
      role: inviteRole,
    });
  };

  if (teamsQuery.isLoading || teamQuery.isLoading) {
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
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    {member.user.name || "Unnamed"}
                  </TableCell>
                  <TableCell>{member.user.email}</TableCell>
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        removeMemberMutation.mutate({
                          teamId: team.id,
                          userId: member.user.id,
                        })
                      }
                      disabled={removeMemberMutation.isPending}
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

      <Card>
        <CardHeader>
          <CardTitle>Invite Member</CardTitle>
          <CardDescription>
            Add a new member to the team by their email address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
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
                <SelectTrigger id="invite-role" className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                  <SelectItem value="EDITOR">Editor</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={addMemberMutation.isPending}>
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
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Manage system configuration and team settings
        </p>
      </div>

      <Tabs defaultValue="auth">
        <TabsList>
          <TabsTrigger value="auth">
            <Shield className="mr-2 h-4 w-4" />
            Auth
          </TabsTrigger>
          <TabsTrigger value="fleet">
            <Server className="mr-2 h-4 w-4" />
            Fleet
          </TabsTrigger>
          <TabsTrigger value="gitops">
            <GitBranch className="mr-2 h-4 w-4" />
            GitOps
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users className="mr-2 h-4 w-4" />
            Team
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auth" className="mt-6">
          <AuthSettings />
        </TabsContent>

        <TabsContent value="fleet" className="mt-6">
          <FleetSettings />
        </TabsContent>

        <TabsContent value="gitops" className="mt-6">
          <GitOpsSettings />
        </TabsContent>

        <TabsContent value="team" className="mt-6">
          <TeamSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
