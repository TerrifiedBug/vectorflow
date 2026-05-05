'use client';

import { AlertTriangle } from 'lucide-react';
import { FadeIn } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Severity = 'error' | 'warning';

interface ErrorStateProps {
  /** Standard error-boundary signature (legacy) */
  error?: Error & { digest?: string };
  reset?: () => void;
  /** Or full-fidelity v2 error pattern */
  title?: string;
  body?: React.ReactNode;
  severity?: Severity;
  diagnostics?: Array<{ label: string; value: React.ReactNode; accent?: boolean }>;
  trySteps?: React.ReactNode[];
  primary?: { label: string; onClick?: () => void; icon?: React.ReactNode };
  secondary?: Array<{ label: string; onClick?: () => void; icon?: React.ReactNode }>;
  className?: string;
}

export function ErrorState({
  error,
  reset,
  title,
  body,
  severity = 'error',
  diagnostics,
  trySteps,
  primary,
  secondary,
  className,
}: ErrorStateProps) {
  // Legacy error-boundary mode
  if (error && !title) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-8">
        <FadeIn className="w-full max-w-md">
          <div className="bg-[color:var(--status-error-bg)] border border-[color:var(--status-error)]/40 border-l-[3px] border-l-status-error rounded-md p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--status-error)]/20 border border-status-error text-status-error font-mono text-[13px] font-semibold">
                !
              </span>
              <h2 className="m-0 font-mono text-[16px] font-medium tracking-[-0.01em] text-fg">
                Something went wrong
              </h2>
            </div>
            <p className="m-0 text-[13px] text-fg-1 leading-relaxed">
              An unexpected error occurred. Try again or refresh the page.
            </p>
            {error.digest && (
              <div className="mt-3 p-2.5 bg-bg-2 border border-line rounded font-mono text-[11px] text-fg-1">
                Error ID: <span className="text-fg">{error.digest}</span>
              </div>
            )}
            {reset && (
              <div className="mt-4">
                <Button variant="primary" size="sm" onClick={reset}>
                  Try again
                </Button>
              </div>
            )}
          </div>
        </FadeIn>
      </div>
    );
  }

  // v2 full-fidelity mode
  const sevColor = severity === 'warning' ? 'status-degraded' : 'status-error';

  return (
    <div className={cn("flex items-center justify-center p-10", className)}>
      <div className="w-[640px]">
        <div
          className={cn(
            "rounded-md p-5 border-l-[3px]",
            severity === 'warning'
              ? "bg-[color:var(--status-degraded-bg)] border border-[color:var(--status-degraded)]/40 border-l-status-degraded"
              : "bg-[color:var(--status-error-bg)] border border-[color:var(--status-error)]/40 border-l-status-error",
          )}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <span
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-[13px] font-semibold",
                severity === 'warning'
                  ? "bg-[color:var(--status-degraded)]/20 border border-status-degraded text-status-degraded"
                  : "bg-[color:var(--status-error)]/20 border border-status-error text-status-error",
              )}
            >
              {severity === 'warning' ? <AlertTriangle className="h-4 w-4" /> : '!'}
            </span>
            <h2 className="m-0 font-mono text-[18px] font-medium tracking-[-0.01em] text-fg">
              {title}
            </h2>
          </div>
          {body && (
            <div className="m-0 text-[13px] text-fg-1 leading-relaxed">
              {body}
            </div>
          )}

          {diagnostics && diagnostics.length > 0 && (
            <div className="mt-3.5 p-3 bg-bg-2 border border-line rounded font-mono text-[11.5px] leading-[1.7]">
              <div className="text-fg-2 mb-1">diagnostics</div>
              {diagnostics.map((d, i) => (
                <div key={i} className="text-fg-1">
                  {d.label}{' '}
                  <span className={d.accent ? `text-${sevColor === 'status-degraded' ? 'status-degraded' : 'accent-brand'}` : 'text-fg'}>
                    {d.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {trySteps && trySteps.length > 0 && (
          <div className="mt-4 text-[12px] text-fg-1 leading-relaxed">
            <div className="font-mono text-fg-2 uppercase tracking-[0.04em] text-[10px] mb-2">Try</div>
            <ul className="m-0 pl-4 space-y-1 list-disc list-outside">
              {trySteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </div>
        )}

        {(primary || secondary) && (
          <div className="mt-5 flex gap-2.5">
            {secondary?.map((s, i) => (
              <Button key={i} variant="ghost" size="md" onClick={s.onClick}>
                {s.icon}
                {s.label}
              </Button>
            ))}
            {primary && (
              <Button variant="primary" size="md" onClick={primary.onClick}>
                {primary.icon}
                {primary.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
