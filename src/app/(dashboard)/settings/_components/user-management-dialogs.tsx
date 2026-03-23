"use client";

import { useState } from "react";
import { Loader2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyToClipboard } from "@/lib/utils";
import { toast } from "sonner";

// ─── Assign to Team Dialog ─────────────────────────────────────────────────────

export interface AssignToTeamDialogProps {
  user: { userId: string; userName: string } | null;
  onClose: () => void;
  teams: { id: string; name: string }[];
  teamId: string;
  onTeamIdChange: (teamId: string) => void;
  role: "VIEWER" | "EDITOR" | "ADMIN";
  onRoleChange: (role: "VIEWER" | "EDITOR" | "ADMIN") => void;
  isPending: boolean;
  onConfirm: () => void;
}

export function AssignToTeamDialog({
  user,
  onClose,
  teams,
  teamId,
  onTeamIdChange,
  role,
  onRoleChange,
  isPending,
  onConfirm,
}: AssignToTeamDialogProps) {
  return (
    <Dialog
      open={!!user}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign to Team</DialogTitle>
          <DialogDescription>
            Assign <span className="font-medium">{user?.userName}</span> to a
            team with a specific role.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="assign-team">Team</Label>
            <Select value={teamId} onValueChange={onTeamIdChange}>
              <SelectTrigger id="assign-team" className="w-full">
                <SelectValue placeholder="Select a team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
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
              value={role}
              onValueChange={(val: "VIEWER" | "EDITOR" | "ADMIN") =>
                onRoleChange(val)
              }
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={isPending || !teamId} onClick={onConfirm}>
            {isPending ? (
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
  );
}

// ─── Lock/Unlock Dialog ────────────────────────────────────────────────────────

export interface UserLockUnlockDialogProps {
  user: { userId: string; userName: string; action: "lock" | "unlock" } | null;
  onClose: () => void;
  isPending: boolean;
  onConfirm: (userId: string, action: "lock" | "unlock") => void;
}

export function UserLockUnlockDialog({
  user,
  onClose,
  isPending,
  onConfirm,
}: UserLockUnlockDialogProps) {
  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {user?.action === "lock" ? "Lock user?" : "Unlock user?"}
          </DialogTitle>
          <DialogDescription>
            {user?.action === "lock" ? (
              <>
                <span className="font-medium">{user?.userName}</span> will be
                unable to log in until unlocked.
              </>
            ) : (
              <>
                <span className="font-medium">{user?.userName}</span> will be
                able to log in again.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={user?.action === "lock" ? "destructive" : "default"}
            disabled={isPending}
            onClick={() => {
              if (!user) return;
              onConfirm(user.userId, user.action);
            }}
          >
            {user?.action === "lock" ? "Lock" : "Unlock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete User Dialog ────────────────────────────────────────────────────────

export interface DeleteUserDialogProps {
  user: { userId: string; userName: string } | null;
  onClose: () => void;
  isPending: boolean;
  onConfirm: (userId: string) => void;
}

export function DeleteUserDialog({
  user,
  onClose,
  isPending,
  onConfirm,
}: DeleteUserDialogProps) {
  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete user?</DialogTitle>
          <DialogDescription>
            This will permanently delete{" "}
            <span className="font-medium">{user?.userName}</span> and all their
            data. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => {
              if (!user) return;
              onConfirm(user.userId);
            }}
          >
            {isPending ? (
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
  );
}

// ─── Create User Dialog ────────────────────────────────────────────────────────

export interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: { id: string; name: string }[];
  isPending: boolean;
  onSubmit: (data: {
    email: string;
    name: string;
    teamId?: string;
    role?: "VIEWER" | "EDITOR" | "ADMIN";
  }) => void;
}

export function CreateUserDialog({
  open,
  onOpenChange,
  teams,
  isPending,
  onSubmit,
}: CreateUserDialogProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState<"VIEWER" | "EDITOR" | "ADMIN">("VIEWER");

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) {
          setEmail("");
          setName("");
          setTeamId("");
          setRole("VIEWER");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>
            Create a new local user account.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              email,
              name,
              ...(teamId ? { teamId, role } : {}),
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-name">Name</Label>
            <Input
              id="new-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="new-user-team">Team (optional)</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger id="new-user-team">
                  <SelectValue placeholder="No team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-role">Role</Label>
              <Select
                value={role}
                onValueChange={(val: "VIEWER" | "EDITOR" | "ADMIN") =>
                  setRole(val)
                }
              >
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
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
  );
}

// ─── Reset Password Dialog ─────────────────────────────────────────────────────

export interface UserResetPasswordDialogProps {
  user: { userId: string; userName: string } | null;
  onClose: () => void;
  /** The generated temporary password, or empty string if not yet generated */
  tempPassword: string;
  isPending: boolean;
  onConfirm: (userId: string) => void;
}

export function UserResetPasswordDialog({
  user,
  onClose,
  tempPassword,
  isPending,
  onConfirm,
}: UserResetPasswordDialogProps) {
  return (
    <Dialog
      open={!!user}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {tempPassword ? (
          <>
            <DialogHeader>
              <DialogTitle>Temporary Password</DialogTitle>
              <DialogDescription>
                Share this temporary password with the user. They will be
                required to change it on first login.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input
                value={tempPassword}
                readOnly
                className="font-mono"
                aria-label="Temporary password"
              />
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
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reset password?</DialogTitle>
              <DialogDescription>
                This will generate a new temporary password for{" "}
                <span className="font-medium">{user?.userName}</span>. They will
                be required to change it on next login.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={isPending}
                onClick={() => {
                  if (!user) return;
                  onConfirm(user.userId);
                }}
              >
                {isPending ? (
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
  );
}

// ─── Password Display Dialog ───────────────────────────────────────────────────

export interface PasswordDisplayDialogProps {
  open: boolean;
  onClose: () => void;
  password: string;
}

export function PasswordDisplayDialog({
  open,
  onClose,
  password,
}: PasswordDisplayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>User Created</DialogTitle>
          <DialogDescription>
            Share this password with the user. It will only be shown once.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={password}
            readOnly
            className="font-mono"
            aria-label="Generated password"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Copy password"
            onClick={async () => {
              await copyToClipboard(password);
              toast.success("Copied to clipboard");
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
