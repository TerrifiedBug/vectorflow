"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Shield, KeyRound } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oidcStatus, setOidcStatus] = useState<{
    enabled: boolean;
    displayName: string;
  } | null>(null);
  const [checkingSetup, setCheckingSetup] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/setup")
        .then((res) => res.json())
        .catch(() => ({ setupRequired: false })),
      fetch("/api/auth/oidc-status")
        .then((res) => res.json())
        .catch(() => ({ enabled: false, displayName: "SSO" })),
    ]).then(([setup, oidc]) => {
      if ((setup as { setupRequired: boolean }).setupRequired) {
        router.replace("/setup");
        return;
      }
      setOidcStatus(oidc as { enabled: boolean; displayName: string });
      setCheckingSetup(false);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        ...(totpRequired && totpCode ? { totpCode } : {}),
        redirect: false,
      });

      const resultWithCode = result as typeof result & { code?: string };
      if (result?.error) {
        if (resultWithCode.code === "TOTP_REQUIRED") {
          setTotpRequired(true);
          setError(null);
        } else if (resultWithCode.code === "INVALID_TOTP") {
          setError("Invalid verification code. Please try again.");
          setTotpCode("");
        } else {
          setError("Invalid email or password.");
        }
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSsoLogin() {
    signIn("oidc", { callbackUrl: "/" });
  }

  function handleBackToLogin() {
    setTotpRequired(false);
    setTotpCode("");
    setError(null);
  }

  if (checkingSetup) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">
          {totpRequired ? "Two-Factor Authentication" : "Sign in to VectorFlow"}
        </CardTitle>
        <CardDescription>
          {totpRequired
            ? "Enter the 6-digit code from your authenticator app."
            : "Enter your credentials to access your account."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {totpRequired ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-center py-2">
                <KeyRound className="h-10 w-10 text-muted-foreground" />
              </div>
              <Label htmlFor="totp-code">Verification Code</Label>
              <Input
                id="totp-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9A-Za-z]*"
                placeholder="Enter 6-digit code or backup code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                required
                autoFocus
                autoComplete="one-time-code"
                className="text-center text-lg tracking-widest"
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3 pt-2">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading
              ? "Verifying..."
              : totpRequired
                ? "Verify"
                : "Sign in"}
          </Button>

          {totpRequired && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={handleBackToLogin}
            >
              Back to login
            </Button>
          )}

          {!totpRequired && oidcStatus?.enabled && (
            <>
              <div className="flex w-full items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleSsoLogin}
              >
                <Shield className="mr-2 h-4 w-4" />
                Sign in with {oidcStatus.displayName}
              </Button>
            </>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
