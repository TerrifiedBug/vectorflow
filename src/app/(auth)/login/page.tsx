"use client";

import { useState, useEffect, Suspense } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shield, KeyRound, Loader2, AlertCircle } from "lucide-react";
import * as m from "motion/react-m";
import type { TargetAndTransition } from "motion/react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { fadeInUp } from "@/components/motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";

const SSO_ERROR_MESSAGES: Record<string, string> = {
  local_account: "This email is registered as a local account. Ask an admin to link it to SSO before signing in.",
  OAuthAccountNotLinked: "This email is already associated with another account. Ask an admin to link it to SSO.",
  OAuthCallback: "SSO sign-in failed. Please try again or contact your administrator.",
  AccessDenied: "Access denied. You may not have permission to sign in via SSO.",
};

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type LoginFormValues = z.infer<typeof loginSchema>;

/**
 * v2 sign-in form — lives inside the two-pane auth layout.
 * See docs/internal/VectorFlow 2.0/screens/other-screens.jsx (ScreenLogin).
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-fg-2" />
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefersReducedMotion = useReducedMotion();
  const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);

  const errorParam = searchParams.get("error");
  const initialError = errorParam
    ? (SSO_ERROR_MESSAGES[errorParam] ?? "An error occurred during sign-in. Please try again.")
    : null;
  const [error, setError] = useState<string | null>(initialError);

  const prefill = searchParams.get("prefill") === "demo";

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: prefill ? "demo@demo.local" : "",
      password: prefill ? "demo" : "",
    },
    mode: "onBlur",
  });

  useEffect(() => {
    if (errorParam) {
      window.history.replaceState({}, "", "/login");
    }
  }, [errorParam]);

  const [oidcStatus, setOidcStatus] = useState<{
    enabled: boolean;
    displayName: string;
    localAuthDisabled: boolean;
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
      setOidcStatus(oidc as { enabled: boolean; displayName: string; localAuthDisabled: boolean });
      setCheckingSetup(false);
    });
  }, [router]);

  async function onSubmit(data: LoginFormValues) {
    form.clearErrors("root");
    setError(null);

    try {
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        ...(totpRequired && totpCode ? { totpCode } : {}),
        redirect: false,
      });

      const resultWithCode = result as typeof result & { code?: string };
      if (result?.error) {
        if (resultWithCode.code === "TOTP_REQUIRED") {
          setTotpRequired(true);
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
    }
  }

  function handleSsoLogin() {
    signIn("oidc", { callbackUrl: "/" });
  }

  function handleBackToLogin() {
    setTotpRequired(false);
    setTotpCode("");
    setTotpError(null);
    setError(null);
  }

  if (checkingSetup) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-fg-2" />
      </div>
    );
  }

  if (oidcStatus?.localAuthDisabled && !oidcStatus?.enabled) {
    return (
      <div>
        <div className="font-mono text-[11px] text-fg-2 uppercase tracking-[0.06em]">
          Sign in
        </div>
        <h2 className="mt-1.5 mb-1 text-[22px] font-semibold tracking-[-0.02em] text-fg">
          Sign in unavailable
        </h2>
        <p className="m-0 text-[13px] text-fg-1 leading-relaxed">
          Local authentication is disabled but SSO is not configured. Contact your administrator.
        </p>
      </div>
    );
  }

  const ssoOnlyMode = oidcStatus?.localAuthDisabled && oidcStatus?.enabled;

  const content = ssoOnlyMode ? (
    <div>
      <div className="font-mono text-[11px] text-fg-2 uppercase tracking-[0.06em]">
        Sign in
      </div>
      <h2 className="mt-1.5 mb-1 text-[22px] font-semibold tracking-[-0.02em] text-fg">
        Welcome back
      </h2>
      <p className="m-0 text-[13px] text-fg-1">
        Use your organization&apos;s single sign-on to continue.
      </p>

      {error && (
        <div className="mt-5 flex items-center gap-2 rounded-[3px] bg-[color:var(--status-error-bg)] border border-[color:var(--status-error)]/40 px-3 py-2 text-[12px] text-status-error">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Button
        type="button"
        variant="primary"
        size="lg"
        className="w-full mt-5 justify-center"
        onClick={handleSsoLogin}
      >
        <Shield className="h-4 w-4" />
        Sign in with {oidcStatus!.displayName}
      </Button>
    </div>
  ) : (
    <div>
      <div className="font-mono text-[11px] text-fg-2 uppercase tracking-[0.06em]">
        Sign in
      </div>
      <h2 className="mt-1.5 mb-1 text-[22px] font-semibold tracking-[-0.02em] text-fg">
        {totpRequired ? "Two-factor verification" : "Welcome back"}
      </h2>
      <p className="m-0 text-[13px] text-fg-1">
        {totpRequired
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter your work email to continue."}
      </p>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-5 flex flex-col gap-3">
          {error && (
            <div className="flex items-center gap-2 rounded-[3px] bg-[color:var(--status-error-bg)] border border-[color:var(--status-error)]/40 px-3 py-2 text-[12px] text-status-error">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {totpRequired ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-center py-2">
                <KeyRound className="h-9 w-9 text-fg-2" />
              </div>
              <Label htmlFor="totp-code" className="font-mono uppercase tracking-[0.06em] text-[10.5px] text-fg-2">
                Verification code
              </Label>
              <Input
                id="totp-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9A-Za-z]*"
                placeholder="6-digit code or backup code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                onBlur={() => {
                  if (totpCode.length === 0) {
                    setTotpError("Enter your 6-digit verification code.");
                  } else {
                    setTotpError(null);
                  }
                }}
                required
                autoFocus
                autoComplete="one-time-code"
                className="text-center text-base tracking-widest h-9"
              />
              {totpError && <p className="text-status-error text-[12px]">{totpError}</p>}
            </div>
          ) : (
            <>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono uppercase tracking-[0.06em] text-[10.5px] text-fg-2">
                      Email
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="you@company.com"
                        autoComplete="email"
                        autoFocus
                        className="h-9"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-[11px]" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono uppercase tracking-[0.06em] text-[10.5px] text-fg-2">
                      Password
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        className="h-9"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-[11px]" />
                  </FormItem>
                )}
              />
            </>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full justify-center mt-1.5"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : totpRequired ? (
              "Verify"
            ) : (
              "Continue"
            )}
          </Button>

          {totpRequired && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-fg-2 self-center"
              onClick={handleBackToLogin}
            >
              Back to sign in
            </Button>
          )}

          {!totpRequired && oidcStatus?.enabled && (
            <>
              <div className="flex items-center gap-2.5 my-2 font-mono text-[10px] text-fg-2">
                <div className="flex-1 h-px bg-line" />
                or
                <div className="flex-1 h-px bg-line" />
              </div>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full justify-center"
                onClick={handleSsoLogin}
              >
                <Shield className="h-4 w-4" />
                Continue with {oidcStatus.displayName}
              </Button>
            </>
          )}
        </form>
      </Form>
    </div>
  );

  if (prefersReducedMotion) {
    return content;
  }

  return (
    <m.div
      initial={fadeInUp.initial as TargetAndTransition}
      animate={fadeInUp.animate as TargetAndTransition}
    >
      {content}
    </m.div>
  );
}
