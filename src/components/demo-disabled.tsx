"use client";

import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { isDemoMode } from "@/lib/is-demo-mode";

const SECTION_CLASS =
  "rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/5 dark:text-amber-200";

const BADGE_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900 dark:bg-amber-500/5 dark:text-amber-200";

export function DemoDisabledBadge({ className = "" }: { className?: string }) {
  if (!isDemoMode()) return null;
  return (
    <span className={`${BADGE_CLASS} ${className}`}>
      <Lock className="h-3 w-3" />
      Demo
    </span>
  );
}

export function DemoDisabledNotice({
  message = "This area is read-only in the public demo. Self-host VectorFlow to configure it.",
}: {
  message?: string;
}) {
  if (!isDemoMode()) return null;
  return (
    <div className={SECTION_CLASS}>
      <p className="flex items-start gap-2">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{message}</span>
      </p>
    </div>
  );
}

/**
 * Wraps form content. In demo mode, prepends a notice and disables every
 * native form control inside via <fieldset disabled>. Outside demo mode,
 * returns children unchanged.
 */
export function DemoDisabledFieldset({
  children,
  message,
}: {
  children: ReactNode;
  message?: string;
}) {
  if (!isDemoMode()) return <>{children}</>;
  return (
    <div className="space-y-4">
      <DemoDisabledNotice message={message} />
      <fieldset disabled className="space-y-6 opacity-70">
        {children}
      </fieldset>
    </div>
  );
}
