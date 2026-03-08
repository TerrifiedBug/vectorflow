"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TotpSetupCard } from "@/components/totp-setup-card";
import { PageHeader } from "@/components/page-header";
import { useTeamStore } from "@/stores/team-store";

export default function ProfilePage() {
  const trpc = useTRPC();
  const router = useRouter();
  const { data: me } = useQuery(trpc.user.me.queryOptions());
  const isLocalUser = me?.authMethod !== "OIDC";

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const roleQuery = useQuery(
    trpc.team.teamRole.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );

  // --- Personal Info ---
  const [name, setName] = useState("");
  const hasLoadedRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!me?.name) return;
    if (hasLoadedRef.current && isDirty) return; // Don't overwrite dirty state on refetch
    hasLoadedRef.current = true;
    setName(me.name);
  }, [me?.name, isDirty]);

  const updateProfileMutation = useMutation(
    // eslint-disable-next-line react-hooks/refs
    trpc.user.updateProfile.mutationOptions({
      onSuccess: () => {
        toast.success("Profile updated");
        setIsDirty(false);
        hasLoadedRef.current = false;
        router.refresh();
      },
      onError: (error) => toast.error(error.message || "Failed to update profile"),
    })
  );

  // --- Change Password ---
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const changePasswordMutation = useMutation(
    trpc.user.changePassword.mutationOptions({
      onSuccess: () => {
        toast.success("Password changed successfully");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      },
      onError: (error) => toast.error(error.message || "Failed to change password"),
    })
  );

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Profile" />
      {/* Personal Info */}
      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
          <CardDescription>
            {isLocalUser
              ? "Update your display name."
              : "Your profile is managed by your SSO provider."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={me?.email ?? ""} disabled className="bg-muted" />
            </div>
            {isLocalUser ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim()) return;
                  updateProfileMutation.mutate({ name: name.trim() });
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="profile-name">Name</Label>
                  <Input
                    id="profile-name"
                    value={name}
                    onChange={(e) => { setIsDirty(true); setName(e.target.value); }}
                    placeholder="Your name"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={updateProfileMutation.isPending || !name.trim() || name.trim() === me?.name}
                >
                  {updateProfileMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </form>
            ) : (
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={me?.name ?? ""} disabled className="bg-muted" />
              </div>
            )}
            {/* Role */}
            <div className="space-y-2">
              <Label>Role</Label>
              <div className="flex items-center gap-2">
                {roleQuery.data ? (
                  <>
                    <Badge variant="secondary">
                      {roleQuery.data.role}
                    </Badge>
                    {roleQuery.data.isSuperAdmin && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                        Super Admin
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password — local users only */}
      {isLocalUser && (
        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>Update your password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
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
              <Button type="submit" size="sm" disabled={changePasswordMutation.isPending}>
                {changePasswordMutation.isPending ? "Changing..." : "Change Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Two-Factor Authentication — local users only */}
      {isLocalUser && me && (
        <>
          {!me.totpEnabled && me.twoFactorRequired && (
            <div className="flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Two-factor authentication is required by your team. Please set it up below.
            </div>
          )}
          {!me.totpEnabled && !me.twoFactorRequired && (
            <div className="flex items-center gap-2 rounded-md border border-blue-500/50 bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-400">
              <Info className="h-4 w-4 shrink-0" />
              We recommend enabling two-factor authentication for added security.
            </div>
          )}
          <TotpSetupCard totpEnabled={me.totpEnabled} authMethod={me.authMethod} />
        </>
      )}
    </div>
  );
}
