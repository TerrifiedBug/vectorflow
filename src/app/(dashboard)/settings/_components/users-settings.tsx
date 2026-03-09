"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
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
  UserPlus,
  Crown,
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
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ─── Users Tab (Super Admin) ────────────────────────────────────────────────────

export function UsersSettings() {
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
                            <button className="flex cursor-pointer items-center gap-1 rounded-md hover:bg-muted/50 px-1 py-0.5 transition-colors">
                              {user.memberships.length === 1 ? (
                                <Badge variant="outline" className="text-xs">
                                  {user.memberships[0].team.name}
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">
                                  {user.memberships.length} teams
                                </Badge>
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
                                    className="cursor-pointer rounded-full transition-colors hover:bg-muted p-0.5"
                                    aria-label="Remove from team"
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
                    {user.authMethod === "OIDC" ? (
                      <span className="text-xs text-muted-foreground">N/A</span>
                    ) : user.totpEnabled ? (
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
