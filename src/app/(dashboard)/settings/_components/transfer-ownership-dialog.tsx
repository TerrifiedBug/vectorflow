"use client";

/**
 * Transfer-ownership dialog.
 *
 * Surfaces the `org.transferOwnership` mutation through a UI that
 * forces the caller to:
 *
 *   1. acknowledge they will be demoted to ADMIN,
 *   2. pick a single non-self successor from the OrgMember roster,
 *   3. tick a hard confirmation checkbox,
 *   4. submit.
 *
 * The mutation is irreversible from this surface — once it lands the
 * caller can only get OWNER back by having the new OWNER (or a peer
 * OWNER) run it again. We rely on the router-side guards as the load-
 * bearing checks; the UI guards exist to prevent unconfirmed clicks.
 *
 * Visibility is controlled by the parent: this dialog renders nothing
 * when `open === false`. Parents MUST gate the trigger on the caller
 * being the current OWNER — the dialog will accept any user but the
 * tRPC mutation will FORBIDDEN non-OWNER callers anyway.
 */

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface OrgMemberOption {
  userId: string;
  name: string | null;
  email: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER" | string;
}

export interface TransferOwnershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Caller's userId — excluded from the candidate list. */
  currentUserId: string;
  /** Full OrgMember roster from `trpc.org.listMembers`. */
  members: OrgMemberOption[];
}

export function TransferOwnershipDialog({
  open,
  onOpenChange,
  currentUserId,
  members,
}: TransferOwnershipDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [toUserId, setToUserId] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const candidates = useMemo(
    () => members.filter((m) => m.userId !== currentUserId),
    [members, currentUserId],
  );

  const transferMutation = useMutation(
    trpc.org.transferOwnership.mutationOptions({
      onSuccess: () => {
        toast.success("Ownership transferred. You are now ADMIN.");
        queryClient.invalidateQueries({
          queryKey: trpc.org.listMembers.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.user.me.queryKey(),
        });
        reset();
        onOpenChange(false);
      },
      onError: (err) => {
        setServerError(err.message ?? "Failed to transfer ownership.");
      },
    }),
  );

  function reset() {
    setToUserId("");
    setConfirmed(false);
    setServerError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  function onSubmit() {
    if (!toUserId || !confirmed || transferMutation.isPending) return;
    setServerError(null);
    transferMutation.mutate({ toUserId });
  }

  const canSubmit = !!toUserId && confirmed && !transferMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer ownership</DialogTitle>
          <DialogDescription>
            You&rsquo;ll be demoted to ADMIN. The new OWNER will receive an
            email. This action is logged in your org audit trail and cannot be
            reversed without the new OWNER (or a peer OWNER) approving.
          </DialogDescription>
        </DialogHeader>

        {serverError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        ) : null}

        {candidates.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              There are no other organisation members to transfer ownership to.
              Invite someone first, then return here.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-owner">New owner</Label>
              <Select value={toUserId} onValueChange={setToUserId}>
                <SelectTrigger id="new-owner">
                  <SelectValue placeholder="Select a member…" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => {
                    const label = c.name ?? c.email ?? c.userId;
                    const sub =
                      c.name && c.email ? c.email : c.name ? null : null;
                    return (
                      <SelectItem key={c.userId} value={c.userId}>
                        <span className="flex flex-col">
                          <span>
                            {label}{" "}
                            <span className="text-muted-foreground">
                              ({c.role})
                            </span>
                          </span>
                          {sub ? (
                            <span className="text-xs text-muted-foreground">
                              {sub}
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="transfer-confirm"
                checked={confirmed}
                onCheckedChange={(checked) => setConfirmed(checked === true)}
              />
              <Label
                htmlFor="transfer-confirm"
                className="text-sm font-normal leading-snug"
              >
                I understand I will lose OWNER privileges on this organisation.
              </Label>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={transferMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            {transferMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Transferring…
              </>
            ) : (
              "Transfer ownership"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
