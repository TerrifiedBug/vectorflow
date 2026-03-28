"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  Shield,
  Trash2,
  Lock,
  Unlock,
  KeyRound,
  UserPlus,
  Crown,
  Plus,
  Users,
  X,
} from "lucide-react";
import {
  AssignToTeamDialog,
  UserLockUnlockDialog,
  DeleteUserDialog,
  CreateUserDialog,
  UserResetPasswordDialog,
  PasswordDisplayDialog,
} from "./user-management-dialogs";

import { Button } from "@/components/ui/button";
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
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryError } from "@/components/query-error";
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
        toast.error(error.message || "Failed to assign user to team", { duration: 6000 });
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
        toast.error(error.message || "Failed to toggle super admin status", { duration: 6000 });
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
        toast.error(error.message || "Failed to delete user", { duration: 6000 });
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
      },
      onError: (error) => toast.error(error.message, { duration: 6000 }),
    })
  );

  const removeFromTeamMutation = useMutation(
    trpc.admin.removeFromTeam.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
        toast.success("User removed from team");
        setRemoveFromTeamConfirm(null);
      },
      onError: (error) => toast.error(error.message, { duration: 6000 }),
    })
  );

  const lockUserMutation = useMutation(
    trpc.admin.lockUser.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
        toast.success("User locked");
      },
      onError: (error) => toast.error(error.message, { duration: 6000 }),
    })
  );

  const unlockUserMutation = useMutation(
    trpc.admin.unlockUser.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
        toast.success("User unlocked");
      },
      onError: (error) => toast.error(error.message, { duration: 6000 }),
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
      onError: (error) => toast.error(error.message, { duration: 6000 }),
    })
  );

  if (usersQuery.isError) return <QueryError message="Failed to load users" onRetry={() => usersQuery.refetch()} />;

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
          {usersQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <EmptyState icon={Users} title="No users" description="Users will appear here once created." />
          ) : (
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
          )}
        </CardContent>
      </Card>

      {/* Extracted dialog components */}
      <AssignToTeamDialog
        user={assignDialog}
        onClose={() => {
          setAssignDialog(null);
          setAssignTeamId("");
          setAssignRole("VIEWER");
        }}
        teams={teamsQuery.data ?? []}
        teamId={assignTeamId}
        onTeamIdChange={setAssignTeamId}
        role={assignRole}
        onRoleChange={setAssignRole}
        isPending={assignMutation.isPending}
        onConfirm={() => {
          if (!assignDialog) return;
          assignMutation.mutate({
            userId: assignDialog.userId,
            teamId: assignTeamId,
            role: assignRole,
          });
        }}
      />

      <UserLockUnlockDialog
        user={lockDialog}
        onClose={() => setLockDialog(null)}
        isPending={lockUserMutation.isPending || unlockUserMutation.isPending}
        onConfirm={(userId, action) => {
          if (action === "lock") {
            lockUserMutation.mutate(
              { userId },
              { onSuccess: () => setLockDialog(null) }
            );
          } else {
            unlockUserMutation.mutate(
              { userId },
              { onSuccess: () => setLockDialog(null) }
            );
          }
        }}
      />

      <DeleteUserDialog
        user={deleteDialog}
        onClose={() => setDeleteDialog(null)}
        isPending={deleteUserMutation.isPending}
        onConfirm={(userId) => deleteUserMutation.mutate({ userId })}
      />

      <CreateUserDialog
        open={createUserOpen}
        onOpenChange={setCreateUserOpen}
        teams={teamsQuery.data ?? []}
        isPending={createUserMutation.isPending}
        onSubmit={(data) => createUserMutation.mutate(data)}
      />

      <UserResetPasswordDialog
        user={resetPasswordDialog}
        onClose={() => {
          if (resetPasswordResult) {
            queryClient.invalidateQueries({ queryKey: trpc.admin.listUsers.queryKey() });
          }
          setResetPasswordDialog(null);
          setResetPasswordResult("");
        }}
        tempPassword={resetPasswordResult}
        isPending={resetPasswordMutation.isPending}
        onConfirm={(userId) => resetPasswordMutation.mutate({ userId })}
      />

      <PasswordDisplayDialog
        open={showCreatedPassword}
        onClose={() => {
          setShowCreatedPassword(false);
          setCreatedPassword("");
        }}
        password={createdPassword}
      />

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
