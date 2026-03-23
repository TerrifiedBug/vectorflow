"use client";

import { Loader2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// ─── Prop Types ────────────────────────────────────────────────────────────────

export interface ResetPasswordDialogProps {
  /** The member whose password is being reset, or null if closed */
  member: { userId: string; name: string } | null;
  onClose: () => void;
  /** Whether the temp password has been generated (shows copy view) */
  showTempPassword: boolean;
  tempPassword: string;
  isPending: boolean;
  onConfirm: (userId: string) => void;
  /** Called when user dismisses the temp-password view */
  onDone: () => void;
}

export function ResetPasswordDialog({
  member,
  onClose,
  showTempPassword,
  tempPassword,
  isPending,
  onConfirm,
  onDone,
}: ResetPasswordDialogProps) {
  return (
    <Dialog
      open={!!member}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {showTempPassword && tempPassword ? (
          <>
            <DialogHeader>
              <DialogTitle>Temporary Password</DialogTitle>
              <DialogDescription>
                Share this temporary password with the user. They will be
                required to change it on next login.
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
              <Button onClick={onDone}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reset password?</DialogTitle>
              <DialogDescription>
                This will generate a new temporary password for{" "}
                <span className="font-medium">{member?.name}</span>. They will
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
                  if (!member) return;
                  onConfirm(member.userId);
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

// ─── Lock/Unlock Dialog ────────────────────────────────────────────────────────

export interface LockUnlockDialogProps {
  member: { userId: string; name: string; action: "lock" | "unlock" } | null;
  onClose: () => void;
  isPending: boolean;
  onConfirm: (userId: string, action: "lock" | "unlock") => void;
}

export function LockUnlockDialog({
  member,
  onClose,
  isPending,
  onConfirm,
}: LockUnlockDialogProps) {
  return (
    <Dialog open={!!member} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {member?.action === "lock" ? "Lock user?" : "Unlock user?"}
          </DialogTitle>
          <DialogDescription>
            {member?.action === "lock" ? (
              <>
                <span className="font-medium">{member?.name}</span> will be
                unable to log in until unlocked.
              </>
            ) : (
              <>
                <span className="font-medium">{member?.name}</span> will be able
                to log in again.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={member?.action === "lock" ? "destructive" : "default"}
            disabled={isPending}
            onClick={() => {
              if (!member) return;
              onConfirm(member.userId, member.action);
            }}
          >
            {member?.action === "lock" ? "Lock" : "Unlock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Link to SSO Dialog ────────────────────────────────────────────────────────

export interface LinkToOidcDialogProps {
  member: { userId: string; name: string } | null;
  onClose: () => void;
  isPending: boolean;
  onConfirm: (userId: string) => void;
}

export function LinkToOidcDialog({
  member,
  onClose,
  isPending,
  onConfirm,
}: LinkToOidcDialogProps) {
  return (
    <Dialog open={!!member} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link to SSO?</DialogTitle>
          <DialogDescription>
            This will convert{" "}
            <span className="font-medium">{member?.name}</span> from local
            authentication to SSO. This action:
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-1">
          <li>
            Removes their password — they can no longer log in with
            email/password
          </li>
          <li>Disables their TOTP 2FA — the SSO provider handles MFA</li>
          <li>Requires them to log in via SSO going forward</li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending}
            onClick={() => {
              if (!member) return;
              onConfirm(member.userId);
            }}
          >
            {isPending ? (
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
  );
}

// ─── Remove Member Dialog ──────────────────────────────────────────────────────

export interface RemoveMemberDialogProps {
  member: { userId: string; name: string } | null;
  onClose: () => void;
  isPending: boolean;
  onConfirm: (userId: string) => void;
}

export function RemoveMemberDialog({
  member,
  onClose,
  isPending,
  onConfirm,
}: RemoveMemberDialogProps) {
  return (
    <Dialog open={!!member} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove team member?</DialogTitle>
          <DialogDescription>
            This will remove{" "}
            <span className="font-medium">{member?.name}</span> from the team.
            They will lose access to all environments and pipelines.
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
              if (!member) return;
              onConfirm(member.userId);
            }}
          >
            {isPending ? "Removing..." : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
