"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Shield, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

import { copyToClipboard } from "@/lib/utils";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TotpSetupCardProps {
  totpEnabled: boolean;
  authMethod: string;
}

export function TotpSetupCard({ totpEnabled, authMethod }: TotpSetupCardProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [setupStep, setSetupStep] = useState<"qr" | "verify" | "done">("qr");
  const codeInputRef = useRef<HTMLInputElement>(null);

  const setupMutation = useMutation(
    trpc.user.setupTotp.mutationOptions({
      onSuccess: async (data) => {
        const dataUrl = await QRCode.toDataURL(data.uri, { width: 200, margin: 2 });
        setQrDataUrl(dataUrl);
        setTotpSecret(data.secret);
        setBackupCodes(data.backupCodes);
        setSetupStep("qr");
        setSetupOpen(true);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to start 2FA setup");
      },
    })
  );

  const verifyMutation = useMutation(
    trpc.user.verifyAndEnableTotp.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.user.me.queryKey() });
        setSetupStep("done");
        toast.success("Two-factor authentication enabled");
      },
      onError: (error) => {
        toast.error(error.message || "Verification failed");
        setVerifyCode("");
      },
    })
  );

  const disableMutation = useMutation(
    trpc.user.disableTotp.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.user.me.queryKey() });
        setDisableOpen(false);
        setDisableCode("");
        toast.success("Two-factor authentication disabled");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to disable 2FA");
        setDisableCode("");
      },
    })
  );

  // Focus code input when moving to verify step
  useEffect(() => {
    if (setupStep === "verify" && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [setupStep]);

  function handleCopyBackupCodes() {
    copyToClipboard(backupCodes.join("\n"));
    toast.success("Backup codes copied to clipboard");
  }

  function handleCopySecret() {
    if (totpSecret) {
      copyToClipboard(totpSecret);
      toast.success("Secret key copied to clipboard");
    }
  }

  function handleCloseSetup() {
    setSetupOpen(false);
    setQrDataUrl(null);
    setTotpSecret(null);
    setBackupCodes([]);
    setVerifyCode("");
    setSetupStep("qr");
  }

  // OIDC users can't use local 2FA
  if (authMethod === "OIDC") {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Two-Factor Authentication
              </CardTitle>
              <CardDescription>
                Add an extra layer of security with a time-based one-time password (TOTP).
              </CardDescription>
            </div>
            {totpEnabled ? (
              <Badge variant="secondary" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Enabled
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {totpEnabled ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Your account is protected with two-factor authentication.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDisableOpen(true)}
              >
                Disable 2FA
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Protect your account by requiring a verification code at sign-in.
              </p>
              <Button
                size="sm"
                onClick={() => setupMutation.mutate()}
                disabled={setupMutation.isPending}
              >
                {setupMutation.isPending ? "Setting up..." : "Enable 2FA"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setup Dialog */}
      <Dialog open={setupOpen} onOpenChange={(open) => { if (!open) handleCloseSetup(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {setupStep === "done"
                ? "2FA Enabled"
                : setupStep === "verify"
                  ? "Verify Setup"
                  : "Set Up Two-Factor Authentication"}
            </DialogTitle>
            <DialogDescription>
              {setupStep === "done"
                ? "Your account is now protected with two-factor authentication."
                : setupStep === "verify"
                  ? "Enter the 6-digit code from your authenticator app to complete setup."
                  : "Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)"}
            </DialogDescription>
          </DialogHeader>

          {setupStep === "qr" && (
            <div className="space-y-4">
              {qrDataUrl && (
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="TOTP QR Code" className="rounded-lg border" />
                </div>
              )}

              {totpSecret && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground text-center">
                    Or enter this key manually:
                  </p>
                  <div className="relative flex items-center justify-center rounded-md border bg-muted/50 px-3 py-2">
                    <code className="font-mono text-sm tracking-wider select-all">{totpSecret}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 h-7 w-7"
                      onClick={handleCopySecret}
                      aria-label="Copy secret key"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium">Backup Codes</p>
                <p className="text-xs text-muted-foreground">
                  Save these codes somewhere safe. Each can be used once if you lose access to your authenticator.
                </p>
                <div className="relative rounded-md border bg-muted/50 p-3">
                  <div className="grid grid-cols-2 gap-1 font-mono text-sm">
                    {backupCodes.map((code, i) => (
                      <span key={i}>{code}</span>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 h-7 w-7"
                    onClick={handleCopyBackupCodes}
                    aria-label="Copy backup codes"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={handleCloseSetup}>
                  Cancel
                </Button>
                <Button onClick={() => setSetupStep("verify")}>
                  Continue
                </Button>
              </DialogFooter>
            </div>
          )}

          {setupStep === "verify" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                verifyMutation.mutate({ code: verifyCode });
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="totp-verify">Verification Code</Label>
                <Input
                  ref={codeInputRef}
                  id="totp-verify"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  required
                  autoComplete="one-time-code"
                  className="text-center text-lg tracking-widest"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSetupStep("qr")}>
                  Back
                </Button>
                <Button type="submit" disabled={verifyMutation.isPending || verifyCode.length !== 6}>
                  {verifyMutation.isPending ? "Verifying..." : "Verify & Enable"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {setupStep === "done" && (
            <div className="space-y-4">
              <div className="flex justify-center py-4">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
              </div>
              <DialogFooter>
                <Button onClick={handleCloseSetup}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Disable Dialog */}
      <Dialog open={disableOpen} onOpenChange={(open) => { if (!open) { setDisableOpen(false); setDisableCode(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Enter your current TOTP code or a backup code to disable 2FA.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              disableMutation.mutate({ code: disableCode });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="totp-disable">Verification Code</Label>
              <Input
                id="totp-disable"
                type="text"
                inputMode="numeric"
                placeholder="Enter code"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                required
                autoFocus
                autoComplete="one-time-code"
                className="text-center text-lg tracking-widest"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setDisableOpen(false); setDisableCode(""); }}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={disableMutation.isPending || !disableCode}>
                {disableMutation.isPending ? "Disabling..." : "Disable 2FA"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
