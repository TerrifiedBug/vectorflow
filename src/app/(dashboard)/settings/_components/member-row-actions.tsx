"use client";

/**
 * OWNER-only per-member roster actions (organisation settings).
 *
 * Exposes two backend capabilities that previously had no client caller:
 *   - `org.resetMemberAuth` — clear a locked-out member's TOTP + passkeys.
 *   - `user.eraseUser` — GDPR Art. 17 erasure of another member's account.
 *
 * Both are OWNER-gated and `denyInDemo()` server-side; the guards here
 * (self/OWNER exclusion, demo disable, typed confirmation) are
 * convenience + accident-prevention, not security. Distinct from the
 * platform-operator `admin.deleteUser` and from `team.removeMember`.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Loader2, MoreHorizontal, Trash2 } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isDemoMode } from "@/lib/is-demo-mode";

interface RosterMember {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
}

const ERASE_MIN_REASON = 12;

export function MemberRowActions({
  member,
  isSelf,
}: {
  member: RosterMember;
  isSelf: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const demo = isDemoMode();

  const [resetOpen, setResetOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseReason, setEraseReason] = useState("");
  const [eraseConfirm, setEraseConfirm] = useState("");

  const label = member.name ?? member.email ?? member.userId;
  const confirmPhrase = member.email ?? member.name ?? "ERASE";

  // resetMemberAuth refuses self; eraseUser refuses self AND OWNER targets.
  const canReset = !isSelf;
  const canErase = !isSelf && member.role !== "OWNER";

  const resetMutation = useMutation(
    trpc.org.resetMemberAuth.mutationOptions({
      onSuccess: () => {
        setResetOpen(false);
        toast.success(
          `Authenticators reset for ${label}. They re-enrol a second factor at next sign-in.`,
        );
      },
      onError: (error) =>
        toast.error(error.message || "Failed to reset authenticators", {
          duration: 6000,
        }),
    }),
  );

  const eraseMutation = useMutation(
    trpc.user.eraseUser.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.org.listMembers.queryKey(),
        });
        setEraseOpen(false);
        setEraseReason("");
        setEraseConfirm("");
        toast.success(`${label}'s account was erased.`);
      },
      onError: (error) =>
        toast.error(error.message || "Failed to erase account", {
          duration: 6000,
        }),
    }),
  );

  if (!canReset && !canErase) return null;

  const eraseValid =
    eraseReason.trim().length >= ERASE_MIN_REASON &&
    eraseConfirm === confirmPhrase;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${label}`}
            disabled={demo}
            title={demo ? "Disabled in the public demo" : undefined}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canReset && (
            <DropdownMenuItem onSelect={() => setResetOpen(true)}>
              <KeyRound className="h-4 w-4" />
              Reset authenticators
            </DropdownMenuItem>
          )}
          {canErase && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setEraseOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Erase account
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={resetOpen}
        onOpenChange={(o) => {
          if (!resetMutation.isPending) setResetOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset authenticators</DialogTitle>
            <DialogDescription>
              This clears <span className="font-medium">{label}</span>&apos;s TOTP
              and all passkeys (WebAuthn). They will re-enrol a second factor at
              next sign-in. Use this to recover a member who is locked out of
              two-factor authentication.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetOpen(false)}
              disabled={resetMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={resetMutation.isPending}
              onClick={() =>
                resetMutation.mutate({ targetUserId: member.userId })
              }
            >
              {resetMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resetting...
                </>
              ) : (
                "Reset authenticators"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={eraseOpen}
        onOpenChange={(o) => {
          if (!eraseMutation.isPending) setEraseOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase account</DialogTitle>
            <DialogDescription>
              Permanently pseudonymises{" "}
              <span className="font-medium">{label}</span>&apos;s account (GDPR
              Art. 17) and removes them from this organisation. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="erase-reason">
                Reason (recorded in the audit log)
              </Label>
              <Textarea
                id="erase-reason"
                value={eraseReason}
                onChange={(e) => setEraseReason(e.target.value)}
                placeholder="e.g. Employee offboarding — data deletion request #1234"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Minimum {ERASE_MIN_REASON} characters.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="erase-confirm">
                Type <span className="font-mono">{confirmPhrase}</span> to confirm
              </Label>
              <Input
                id="erase-confirm"
                value={eraseConfirm}
                onChange={(e) => setEraseConfirm(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEraseOpen(false)}
              disabled={eraseMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!eraseValid || eraseMutation.isPending}
              onClick={() =>
                eraseMutation.mutate({
                  targetUserId: member.userId,
                  reason: eraseReason.trim(),
                })
              }
            >
              {eraseMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Erasing...
                </>
              ) : (
                "Erase account"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
