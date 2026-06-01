"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Info, Trash2, ShieldAlert } from "lucide-react";

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
import { useTeamStore } from "@/stores/team-store";
import { PageHeader } from "@/components/page-header";
import { signIn, signOut } from "next-auth/react";
import { isDemoMode } from "@/lib/is-demo-mode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ERASE_CONFIRM = "erase my account";

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
      onError: (error) => toast.error(error.message || "Failed to update profile", { duration: 6000 }),
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
      onError: (error) => toast.error(error.message || "Failed to change password", { duration: 6000 }),
    })
  );

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters", { duration: 6000 });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match", { duration: 6000 });
      return;
    }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  }
  // --- Delete account (GDPR self-erasure) ---
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const demo = isDemoMode();
  const [reauthedForErase, setReauthedForErase] = useState(false);

  // OIDC self-erasure requires a fresh re-auth at the IdP — the server trusts
  // the just-issued session and delegates re-auth to the client (see
  // user.eraseSelf). After signIn(prompt=login) returns to
  // /profile?reauth=erase, resume in the confirm phase and strip the marker
  // so a refresh cannot replay it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reauth") !== "erase") return;
    // Resume the OIDC self-erase after the prompt=login redirect. Done in an
    // effect (not lazy initial state) so the first client render matches the
    // server and there's no hydration mismatch.
    /* eslint-disable react-hooks/set-state-in-effect */
    setReauthedForErase(true);
    setDeleteOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    window.history.replaceState(null, "", "/profile");
  }, []);

  function handleReauthForErase() {
    void signIn(
      "oidc",
      { callbackUrl: "/profile?reauth=erase" },
      { prompt: "login" },
    );
  }

  const eraseSelfMutation = useMutation(
    trpc.user.eraseSelf.mutationOptions({
      onSuccess: () => {
        toast.success("Your account has been erased. Signing you out…");
        void signOut({ callbackUrl: "/login" });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to erase account", { duration: 6000 });
      },
    }),
  );

  const eraseValid =
    deleteConfirm === ERASE_CONFIRM && (!isLocalUser || deletePassword.length > 0);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Profile"
        description="Manage identity, local password, and two-factor authentication for this account."
        className="px-0 pt-0"
      />
      <div className="max-w-2xl space-y-6">
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
                    {roleQuery.data.isOrgAdmin && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                        Org Admin
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

      {/* Danger zone — self-erasure */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-4 w-4" />
            Danger zone
          </CardTitle>
          <CardDescription>
            Permanently erase your VectorFlow account. This pseudonymises your
            personal data (GDPR Art. 17), removes you from every organisation and
            team, and signs you out. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <p className="text-sm text-muted-foreground">
            If you are the sole owner of an organisation with other members,
            transfer ownership before erasing your account.
          </p>
          <Button
            variant="destructive"
            className="shrink-0"
            disabled={demo}
            title={demo ? "Disabled in the public demo" : undefined}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete account
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          if (!eraseSelfMutation.isPending) setDeleteOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account</DialogTitle>
            <DialogDescription>
              This permanently erases your account and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {isLocalUser ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="erase-self-password">Current password</Label>
                  <Input
                    id="erase-self-password"
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="erase-self-confirm">
                    Type <span className="font-mono">{ERASE_CONFIRM}</span> to confirm
                  </Label>
                  <Input
                    id="erase-self-confirm"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </>
            ) : reauthedForErase ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Re-authenticated. Type the phrase below to permanently erase your
                  account.
                </p>
                <Label htmlFor="erase-self-confirm">
                  Type <span className="font-mono">{ERASE_CONFIRM}</span> to confirm
                </Label>
                <Input
                  id="erase-self-confirm"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  autoComplete="off"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                For security, you&apos;ll be redirected to your identity provider to
                re-authenticate before your account can be erased.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={eraseSelfMutation.isPending}
            >
              Cancel
            </Button>
            {!isLocalUser && !reauthedForErase ? (
              <Button variant="destructive" onClick={handleReauthForErase}>
                Re-authenticate to continue
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={!eraseValid || eraseSelfMutation.isPending}
                onClick={() =>
                  eraseSelfMutation.mutate({
                    confirmation: ERASE_CONFIRM,
                    currentPassword: isLocalUser ? deletePassword : undefined,
                  })
                }
              >
                {eraseSelfMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Erasing...
                  </>
                ) : (
                  "Delete my account"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
