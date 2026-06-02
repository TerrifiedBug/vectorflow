"use client";

/**
 * Guided getting-started checklist for new tenants.
 *
 * Renders the activation path — enroll an agent → build a pipeline → deploy
 * and watch it flow — with live completion state derived from real counts the
 * dashboard already loads. It is the cold-start guidance the product otherwise
 * lacked (a brand-new OWNER previously landed on a static empty state).
 *
 * Two variants:
 *   - "full"   — the primary content of an empty dashboard (no dismiss; there
 *                is nothing else to show yet).
 *   - "banner" — a compact, dismissible banner above a populated dashboard,
 *                so a user who enrolled an agent but hasn't built/deployed a
 *                pipeline still gets nudged. Dismissal is per-browser
 *                (localStorage) and the whole checklist self-hides once every
 *                step is complete.
 */

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "vf:onboarding-dismissed";

function readDismissed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem(DISMISS_KEY) === "1";
  } catch {
    // Storage unavailable (private mode / disabled) — treat as not dismissed.
    return false;
  }
}

function subscribeDismissed(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Re-render on dismissal from this tab (custom event) or another tab (storage).
  window.addEventListener(DISMISS_KEY, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DISMISS_KEY, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export interface OnboardingChecklistProps {
  /** Selected environment id — targets the agent-enrollment deep link. */
  environmentId: string;
  /** At least one agent (VectorNode) has enrolled into this org. */
  agentEnrolled: boolean;
  /** At least one pipeline exists. */
  pipelineCreated: boolean;
  /** At least one pipeline is actively running on an agent. */
  pipelineDeployed: boolean;
  variant?: "full" | "banner";
}

interface Step {
  key: string;
  title: string;
  description: string;
  done: boolean;
  cta?: { label: string; href: string };
}

export function OnboardingChecklist({
  environmentId,
  agentEnrolled,
  pipelineCreated,
  pipelineDeployed,
  variant = "banner",
}: OnboardingChecklistProps) {
  // Dismissal applies only to the banner (the full variant is the empty
  // dashboard's only content). Read browser storage via useSyncExternalStore:
  // SSR-safe (server snapshot = not dismissed), no setState-in-effect.
  const dismissible = variant === "banner";
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => false);

  const steps: Step[] = [
    {
      key: "environment",
      title: "Create an environment",
      description: "Environments isolate your dev, staging, and prod fleets.",
      done: true,
    },
    {
      key: "agent",
      title: "Enroll an agent",
      description:
        "Generate an enrollment token and connect your first vf-agent.",
      done: agentEnrolled,
      cta: { label: "Get enrollment token", href: `/environments/${environmentId}` },
    },
    {
      key: "pipeline",
      title: "Build a pipeline",
      description: "Wire sources → transforms → sinks on the canvas, or start from a template.",
      done: pipelineCreated,
      cta: { label: "Create pipeline", href: "/pipelines/new" },
    },
    {
      key: "deploy",
      title: "Deploy & watch it flow",
      description: "Push the pipeline to your agents and watch telemetry move.",
      done: pipelineDeployed,
      cta: { label: "View pipelines", href: "/pipelines" },
    },
  ];

  const completedCount = steps.filter((step) => step.done).length;
  const allDone = completedCount === steps.length;
  if (allDone || (dismissible && dismissed)) return null;

  const currentStep = steps.find((step) => !step.done);

  const dismiss = () => {
    try {
      window.localStorage?.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage write blocked — dismissal is best-effort for this session.
    }
    // useSyncExternalStore's storage listener only fires cross-tab; notify this tab.
    window.dispatchEvent(new Event(DISMISS_KEY));
  };

  return (
    <section
      aria-label="Getting started"
      className={cn(
        "rounded-lg border border-line-2 bg-bg-2",
        variant === "full" ? "mx-auto mt-8 max-w-2xl p-6" : "p-4",
      )}
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-fg">Get started with VectorFlow</h2>
          <p className="mt-0.5 text-[12px] text-fg-1">
            {completedCount} of {steps.length} steps complete
          </p>
        </div>
        {dismissible ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={dismiss}
            aria-label="Dismiss getting-started checklist"
          >
            Dismiss
          </Button>
        ) : null}
      </header>

      <ol className="mt-4 space-y-3">
        {steps.map((step) => {
          const isCurrent = step.key === currentStep?.key;
          return (
            <li
              key={step.key}
              aria-current={isCurrent ? "step" : undefined}
              className="flex items-start gap-3"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                  step.done
                    ? "border-accent-brand bg-accent-brand text-primary-foreground"
                    : isCurrent
                      ? "border-accent-brand text-accent-brand"
                      : "border-line-2 text-fg-2",
                )}
              >
                {step.done ? "✓" : isCurrent ? "→" : "○"}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[13px]",
                    step.done ? "text-fg-1 line-through" : "text-fg",
                  )}
                >
                  {step.title}
                </p>
                <p className="mt-0.5 text-[12px] text-fg-1">{step.description}</p>
                {isCurrent && step.cta ? (
                  <Button asChild size="sm" variant="primary" className="mt-2">
                    <Link href={step.cta.href}>{step.cta.label}</Link>
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
