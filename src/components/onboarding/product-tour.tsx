"use client";

/**
 * Lightweight, dependency-free first-run product tour.
 *
 * Walks a brand-new user through the core surfaces (pipelines, the demo-pipeline
 * action, the agent fleet, alerts) with a small coachmark card anchored next to
 * real on-screen elements via `getBoundingClientRect`. Deliberately self-contained
 * — no tour library, no Radix portal/observer machinery — so it stays trivially
 * testable in jsdom and adds zero dependencies.
 *
 * Behaviour:
 *   - Auto-starts once per browser; completion/skip is persisted in localStorage
 *     (`vf:tour-dismissed`, matching the onboarding-checklist convention) so it
 *     never nags twice.
 *   - Re-startable from anywhere via `startProductTour()` (the onboarding
 *     checklist's "Take a tour" action), which clears the dismissal first.
 *   - Each step targets a CSS selector; a missing target is handled gracefully
 *     (the card anchors to a safe centered position rather than crashing), and
 *     auto-start is suppressed entirely when none of the targets exist.
 *   - Accessible: a focusable role="dialog" card, Esc to dismiss, labelled
 *     controls, and a screen-reader step counter.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TourStep {
  /** Short heading shown at the top of the coachmark. */
  title: string;
  /** One- or two-sentence explanation of the surface. */
  body: string;
  /** CSS selector for the on-screen element this step points at. */
  targetSelector: string;
}

const TOUR_DISMISSED_KEY = "vf:tour-dismissed";
const TOUR_START_EVENT = "vf:tour-start";

/** Selector marking the dashboard's "Create a demo pipeline" action. */
export const TOUR_DEMO_PIPELINE_ATTR = "create-demo-pipeline";

/**
 * The default ~4-step tour of VectorFlow's core surfaces. Steps anchor to the
 * persistent sidebar nav (always present on dashboard routes) plus the
 * empty-dashboard demo action (gracefully skipped when absent).
 */
export const DEFAULT_TOUR_STEPS: TourStep[] = [
  {
    title: "Build your pipelines",
    body: "Wire sources → transforms → sinks on the canvas. Every pipeline you create lives under Pipelines.",
    targetSelector: 'a[href="/pipelines"]',
  },
  {
    title: "Start from a demo",
    body: "No agent yet? Spin up a complete sample pipeline in one click and explore the editor right away.",
    targetSelector: `[data-tour="${TOUR_DEMO_PIPELINE_ATTR}"]`,
  },
  {
    title: "Manage your fleet",
    body: "Enroll vf-agents and watch their health, throughput, and assigned pipelines from Fleet.",
    targetSelector: 'a[href="/fleet"]',
  },
  {
    title: "Stay ahead with alerts",
    body: "Define alert rules on throughput and errors so you hear about problems before your users do.",
    targetSelector: 'a[href="/alerts"]',
  },
];

function readDismissed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem(TOUR_DISMISSED_KEY) === "1";
  } catch {
    // Storage unavailable (private mode / disabled) — treat as not dismissed.
    return false;
  }
}

function hasAnyTarget(steps: TourStep[]): boolean {
  if (typeof document === "undefined") return false;
  return steps.some((step) => document.querySelector(step.targetSelector) !== null);
}

/**
 * (Re)start the product tour from anywhere on the client (e.g. the onboarding
 * checklist's "Take a tour" action). Clears the one-time dismissal so an
 * explicit restart always reopens the tour at step one.
 */
export function startProductTour(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.removeItem(TOUR_DISMISSED_KEY);
  } catch {
    // Ignore — the start event below still fires.
  }
  window.dispatchEvent(new Event(TOUR_START_EVENT));
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Coords {
  top: number;
  left: number;
  /** The anchored target's rect when found — drives the highlight ring. */
  rect: TargetRect | null;
}

const CARD_WIDTH = 320;
const CARD_OFFSET = 12;
const CARD_EST_HEIGHT = 180;

/** Position the card beside the target, clamped to the viewport. */
function computeCoords(target: Element | null): Coords {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;

  // Missing target (absent selector or not-yet-mounted): anchor safely so the
  // step content is still reachable instead of crashing or vanishing.
  if (!target) {
    return {
      top: Math.max(CARD_OFFSET, Math.round(vh * 0.18)),
      left: Math.max(CARD_OFFSET, Math.round((vw - CARD_WIDTH) / 2)),
      rect: null,
    };
  }

  const r = target.getBoundingClientRect();
  // Prefer the target's right edge (sidebar nav); flip to the left if it would
  // overflow, then fall back to centered.
  let left = r.right + CARD_OFFSET;
  if (left + CARD_WIDTH > vw - CARD_OFFSET) left = r.left - CARD_WIDTH - CARD_OFFSET;
  if (left < CARD_OFFSET) left = Math.max(CARD_OFFSET, Math.round((vw - CARD_WIDTH) / 2));

  let top = r.top;
  if (top + CARD_EST_HEIGHT > vh - CARD_OFFSET) top = vh - CARD_EST_HEIGHT - CARD_OFFSET;
  if (top < CARD_OFFSET) top = CARD_OFFSET;

  return {
    top,
    left,
    rect: { top: r.top, left: r.left, width: r.width, height: r.height },
  };
}

export interface ProductTourProps {
  /** Steps to walk through. Defaults to the core-surfaces tour. */
  steps?: TourStep[];
  /** Auto-open once per browser when not yet dismissed. Defaults to true. */
  autoStart?: boolean;
}

export function ProductTour({ steps = DEFAULT_TOUR_STEPS, autoStart = true }: ProductTourProps) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [coords, setCoords] = useState<Coords>({ top: 0, left: 0, rect: null });
  const cardRef = useRef<HTMLDivElement>(null);

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  const close = useCallback((persist: boolean) => {
    if (persist) {
      try {
        window.localStorage?.setItem(TOUR_DISMISSED_KEY, "1");
      } catch {
        // Storage write blocked — dismissal is best-effort for this session.
      }
    }
    setActive(false);
    setIndex(0);
  }, []);

  // Auto-start once per browser, and always respond to an explicit restart.
  useEffect(() => {
    const start = () => {
      setIndex(0);
      setActive(true);
    };
    if (autoStart && !readDismissed() && hasAnyTarget(steps)) start();
    window.addEventListener(TOUR_START_EVENT, start);
    return () => window.removeEventListener(TOUR_START_EVENT, start);
  }, [autoStart, steps]);

  // Position the card against the current step's target; track resize/scroll.
  useEffect(() => {
    if (!active || !step) return;
    const reposition = () => setCoords(computeCoords(document.querySelector(step.targetSelector)));
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [active, step]);

  // Move focus to the card on open and on each step change (announces the new
  // step to assistive tech, since the card is the labelled dialog).
  useEffect(() => {
    if (active) cardRef.current?.focus();
  }, [active, index]);

  // Esc dismisses the tour (and persists the one-time flag).
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, close]);

  if (!active || !step) return null;

  const titleId = "vf-product-tour-title";
  const bodyId = "vf-product-tour-body";
  return (
    <>
      {coords.rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[60] rounded-md ring-2 ring-accent-brand ring-offset-2 ring-offset-bg transition-all duration-150 motion-reduce:transition-none"
          style={{
            top: coords.rect.top,
            left: coords.rect.left,
            width: coords.rect.width,
            height: coords.rect.height,
          }}
        />
      ) : null}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        style={{ top: coords.top, left: coords.left, width: CARD_WIDTH }}
        className="fixed z-[70] rounded-lg border border-line-2 bg-bg-2 p-4 shadow-lg outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-sm font-medium text-fg">
            {step.title}
          </h2>
          <Button variant="ghost" size="icon-xs" onClick={() => close(true)} aria-label="Skip tour">
            <X />
          </Button>
        </div>
        <p id={bodyId} className="mt-1.5 text-[13px] leading-relaxed text-fg-1">
          {step.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "size-1.5 rounded-full transition-colors",
                  i === index ? "bg-accent-brand" : "bg-line-2",
                )}
              />
            ))}
          </div>
          <span className="sr-only">
            Step {index + 1} of {steps.length}
          </span>
          <div className="flex items-center gap-2">
            {isFirst ? (
              <Button variant="ghost" size="sm" onClick={() => close(true)}>
                Skip
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setIndex((i) => Math.max(0, i - 1))}>
                Back
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => (isLast ? close(true) : setIndex((i) => Math.min(steps.length - 1, i + 1)))}
            >
              {isLast ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
