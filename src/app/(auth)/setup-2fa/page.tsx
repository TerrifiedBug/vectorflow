"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Shield, Copy, CheckCircle2, AlertTriangle, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import * as m from "motion/react-m";
import type { TargetAndTransition } from "motion/react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { fadeInUp } from "@/components/motion";

import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Setup2FAPage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const { status } = useSession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const meQuery = useQuery(trpc.user.me.queryOptions());
  const me = meQuery.data;

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState("");
  const [step, setStep] = useState<"qr" | "verify" | "done">("qr");
  const [started, setStarted] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  // If user already has 2FA enabled, go straight to dashboard
  useEffect(() => {
    if (me?.totpEnabled) {
      router.replace("/");
    }
  }, [me, router]);

  const setupMutation = useMutation(
    trpc.user.setupTotp.mutationOptions({
      onSuccess: async (data) => {
        const dataUrl = await QRCode.toDataURL(data.uri, { width: 200, margin: 2 });
        setQrDataUrl(dataUrl);
        setTotpSecret(data.secret);
        setBackupCodes(data.backupCodes);
        setStep("qr");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to start 2FA setup", { duration: 6000 });
      },
    })
  );

  const verifyMutation = useMutation(
    trpc.user.verifyAndEnableTotp.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.user.me.queryKey() });
        setStep("done");
        toast.success("Two-factor authentication enabled");
      },
      onError: (error) => {
        toast.error(error.message || "Verification failed", { duration: 6000 });
        setVerifyCode("");
      },
    })
  );

  // Auto-start setup when page loads
  useEffect(() => {
    if (me && !me.totpEnabled && !started && me.authMethod !== "OIDC") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStarted(true);
      setupMutation.mutate();
    }
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus code input when moving to verify step
  useEffect(() => {
    if (step === "verify" && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [step]);

  function handleCopySecret() {
    if (totpSecret) {
      copyToClipboard(totpSecret);
      toast.success("Secret key copied to clipboard");
    }
  }

  function handleCopyBackupCodes() {
    copyToClipboard(backupCodes.join("\n"));
    toast.success("Backup codes copied to clipboard");
  }

  function handleDownloadBackupCodes() {
    const content = backupCodes.join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vectorflow-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (status === "loading" || meQuery.isLoading) {
    return (
      <Card className="w-full hover:translate-y-0 hover:shadow-none">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Skeleton className="h-40 w-40 rounded-lg" />
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    );
  }

  const card = (
    <Card className="w-full hover:translate-y-0 hover:shadow-none">
      <div className="flex items-center gap-2 px-6 pt-6">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            step === "qr" || step === "verify" || step === "done"
              ? "bg-primary"
              : "bg-muted-foreground/30"
          )}
        />
        <p className="text-xs text-muted-foreground">Scan QR Code</p>
        <div className="h-px flex-1 bg-border" />
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            step === "verify" || step === "done"
              ? "bg-primary"
              : "bg-muted-foreground/30"
          )}
        />
        <p className="text-xs text-muted-foreground">Verify Code</p>
        <div className="h-px flex-1 bg-border" />
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            step === "done" ? "bg-primary" : "bg-muted-foreground/30"
          )}
        />
        <p className="text-xs text-muted-foreground">Complete</p>
      </div>

      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Shield className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>
          {step === "done" ? "You're All Set" : "Set Up Two-Factor Authentication"}
        </CardTitle>
        <CardDescription>
          {step === "done"
            ? "Your account is now protected with two-factor authentication."
            : step === "verify"
              ? "Enter the 6-digit code from your authenticator app to complete setup."
              : "Your organization requires two-factor authentication. Scan the QR code with an authenticator app such as Google Authenticator or Authy."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {step === "qr" && (
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
                    title="Copy secret key"
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
                  title="Copy backup codes"
                  aria-label="Copy backup codes"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleDownloadBackupCodes}
              >
                <Download className="mr-2 h-4 w-4" />
                Download backup codes
              </Button>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>
                Save these backup codes before continuing. Each code can be used once if you lose
                access to your authenticator app. They cannot be shown again.
              </p>
            </div>

            <Button className="w-full" onClick={() => setStep("verify")}>
              Continue
            </Button>
          </div>
        )}

        {step === "verify" && (
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
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("qr")}>
                Back
              </Button>
              <Button type="submit" className="flex-1" disabled={verifyMutation.isPending || verifyCode.length !== 6}>
                {verifyMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify & Enable"
                )}
              </Button>
            </div>
          </form>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="flex justify-center py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
            <Button className="w-full" onClick={() => router.replace("/")}>
              Continue to Dashboard
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (prefersReducedMotion) {
    return card;
  }

  return (
    <m.div
      initial={fadeInUp.initial as TargetAndTransition}
      animate={fadeInUp.animate as TargetAndTransition}
    >
      {card}
    </m.div>
  );
}
