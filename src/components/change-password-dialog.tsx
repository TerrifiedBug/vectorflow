"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forced?: boolean;
}

export function ChangePasswordDialog({ open, onOpenChange, forced }: ChangePasswordDialogProps) {
  const trpc = useTRPC();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const changeMutation = useMutation(
    trpc.user.changePassword.mutationOptions({
      onSuccess: () => {
        toast.success("Password changed successfully");
        onOpenChange(false);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to change password", { duration: 6000 });
      },
    })
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters", { duration: 6000 });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match", { duration: 6000 });
      return;
    }
    changeMutation.mutate({ currentPassword, newPassword });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={forced ? undefined : handleOpenChange}>
      <DialogContent className="sm:max-w-md" onInteractOutside={forced ? (e) => e.preventDefault() : undefined}>
        <DialogHeader>
          <DialogTitle>{forced ? "Password Change Required" : "Change Password"}</DialogTitle>
          <DialogDescription>
            {forced
              ? "Your password must be changed before you can continue."
              : "Enter your current password and choose a new one."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
            <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            {!forced && (
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={changeMutation.isPending}>
              {changeMutation.isPending ? "Changing..." : "Change Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
