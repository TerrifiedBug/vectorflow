"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { copyToClipboard } from "@/lib/utils";
import { toast } from "sonner";
import {
  Shield,
  Loader2,
  Trash2,
  Lock,
  Unlock,
  KeyRound,
  Copy,
  Plus,
  X,
  Link2,
  Info,
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

// ─── Team Tab ──────────────────────────────────────────────────────────────────

export function TeamSettings() {
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

  // settings.get requires super-admin — silently degrade for team admins
  const settingsQuery = useQuery({
    ...trpc.settings.get.queryOptions(),
    retry: false,
    throwOnError: false,
  });
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

  // Environments for default environment dropdown
  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId }
    )
  );
  const environments = environmentsQuery.data ?? [];

  const updateDefaultEnvMutation = useMutation(
    trpc.team.updateDefaultEnvironment.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.get.queryKey() });
        toast.success("Default environment updated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update default environment");
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
          <Separator className="my-4" />
          <div className="space-y-2">
            <Label>Default Environment</Label>
            <p className="text-sm text-muted-foreground">
              Fallback environment for team members who haven&apos;t set a personal default.
            </p>
            <Select
              value={team.defaultEnvironmentId ?? ""}
              onValueChange={(value) =>
                updateDefaultEnvMutation.mutate({
                  teamId: selectedTeamId!,
                  defaultEnvironmentId: value || null,
                })
              }
              disabled={updateDefaultEnvMutation.isPending}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="None (use first in list)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {environments.map((env) => (
                  <SelectItem key={env.id} value={env.id}>
                    {env.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                    {(member.user.authMethod === "OIDC" || member.user.scimExternalId) ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="w-[120px] justify-center">
                          {member.role}
                        </Badge>
                        <span className="text-xs text-muted-foreground" title="Role managed by identity provider">
                          <Lock className="h-3 w-3" />
                        </span>
                      </div>
                    ) : (
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
                    )}
                  </TableCell>
                  <TableCell>
                    {member.user.authMethod === "OIDC" ? (
                      <span className="text-xs text-muted-foreground">N/A</span>
                    ) : member.user.totpEnabled ? (
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
        <CardContent className="space-y-4">
          {(settingsQuery.data?.scimEnabled || settingsQuery.data?.oidcGroupSyncEnabled) && (
            <div className="flex items-start gap-2 rounded-md border border-status-info/30 bg-status-info-bg p-3 text-sm text-status-info-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>SSO users are managed by your identity provider. Only local users can be added manually.</span>
            </div>
          )}
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
                  className="inline-flex cursor-pointer items-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
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
