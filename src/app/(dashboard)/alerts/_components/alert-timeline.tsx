"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { isFleetMetric } from "@/lib/alert-metrics";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface AlertEvent {
  id: string;
  status: string;
  value: number;
  message: string | null;
  firedAt: Date;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  node: { id: string; host: string } | null;
  alertRule: {
    id: string;
    name: string;
    metric: string;
    condition: string | null;
    threshold: number | null;
    pipeline: { id: string; name: string } | null;
  };
}

interface AlertTimelineProps {
  events: AlertEvent[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatTimestamp(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString();
}

/** Format the duration between two dates as a human-readable string. */
function formatDuration(from: Date | string, to: Date | string): string {
  const a = typeof from === "string" ? new Date(from) : from;
  const b = typeof to === "string" ? new Date(to) : to;
  const diffMs = Math.abs(b.getTime() - a.getTime());

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  if (hours < 24) {
    return remainingMin > 0 ? `${hours}h ${remainingMin}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

// ─── State Transition Step ──────────────────────────────────────────────────────

type StepVariant = "error" | "degraded" | "healthy";

interface TransitionStep {
  label: string;
  timestamp: Date;
  variant: StepVariant;
  detail?: string;
}

function buildTransitionSteps(event: AlertEvent): TransitionStep[] {
  const steps: TransitionStep[] = [];

  // Step 1: always fired
  steps.push({
    label: "Fired",
    timestamp:
      typeof event.firedAt === "string"
        ? new Date(event.firedAt)
        : event.firedAt,
    variant: "error",
  });

  // Step 2: acknowledged (optional)
  if (event.acknowledgedAt) {
    const ackDate =
      typeof event.acknowledgedAt === "string"
        ? new Date(event.acknowledgedAt)
        : event.acknowledgedAt;
    steps.push({
      label: "Acknowledged",
      timestamp: ackDate,
      variant: "degraded",
      detail: event.acknowledgedBy
        ? `by ${event.acknowledgedBy}`
        : undefined,
    });
  }

  // Step 3: resolved (optional)
  if (event.resolvedAt) {
    const resDate =
      typeof event.resolvedAt === "string"
        ? new Date(event.resolvedAt)
        : event.resolvedAt;
    steps.push({
      label: "Resolved",
      timestamp: resDate,
      variant: "healthy",
    });
  }

  return steps;
}

// ─── Dot color mapping ──────────────────────────────────────────────────────────

const dotColor: Record<StepVariant, string> = {
  error: "bg-status-error",
  degraded: "bg-status-degraded",
  healthy: "bg-status-healthy",
};

// ─── Single Event Timeline Card ─────────────────────────────────────────────────

function EventTimelineCard({ event }: { event: AlertEvent }) {
  const steps = buildTransitionSteps(event);

  return (
    <Card className="py-4">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">
            {event.alertRule.name}
          </CardTitle>
          <StatusBadge
            variant={
              event.status === "firing"
                ? "error"
                : event.status === "acknowledged"
                  ? "degraded"
                  : "healthy"
            }
          >
            {event.status === "firing"
              ? "Firing"
              : event.status === "acknowledged"
                ? "Acknowledged"
                : "Resolved"}
          </StatusBadge>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {event.node ? (
            <span>Node: {event.node.host}</span>
          ) : isFleetMetric(event.alertRule.metric) ? (
            <span>Scope: Fleet</span>
          ) : null}
          {event.alertRule.pipeline && (
            <span>Pipeline: {event.alertRule.pipeline.name}</span>
          )}
          <span>
            {event.alertRule.metric}{" "}
            {event.alertRule.condition ?? ">"}{" "}
            {event.alertRule.threshold ?? "—"} (actual:{" "}
            {typeof event.value === "number"
              ? event.value.toFixed(2)
              : event.value}
            )
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Vertical mini-timeline */}
        <div className="relative ml-2 mt-3 space-y-0">
          {steps.map((step, idx) => {
            const isLast = idx === steps.length - 1;
            const nextStep = steps[idx + 1];

            return (
              <div key={step.label} className="relative flex items-start gap-3">
                {/* Vertical connector line */}
                {!isLast && (
                  <div className="absolute left-[5px] top-[14px] bottom-0 w-px bg-border" />
                )}

                {/* Dot */}
                <div
                  className={`mt-[5px] h-[11px] w-[11px] shrink-0 rounded-full border-2 border-background ring-2 ${dotColor[step.variant]}`}
                  style={{ zIndex: 1 }}
                />

                {/* Content */}
                <div className={`pb-${isLast ? "0" : "5"} min-w-0`}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{step.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(step.timestamp)}
                    </span>
                  </div>
                  {step.detail && (
                    <p className="text-xs text-muted-foreground">
                      {step.detail}
                    </p>
                  )}
                  {/* Duration between this step and next */}
                  {nextStep && (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      {step.label} for{" "}
                      {formatDuration(step.timestamp, nextStep.timestamp)}{" "}
                      before {nextStep.label.toLowerCase()}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main AlertTimeline ─────────────────────────────────────────────────────────

export function AlertTimeline({ events }: AlertTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No alert events to display.
      </p>
    );
  }

  // Most recent first — sort descending by firedAt
  const sorted = [...events].sort((a, b) => {
    const da = typeof a.firedAt === "string" ? new Date(a.firedAt) : a.firedAt;
    const db = typeof b.firedAt === "string" ? new Date(b.firedAt) : b.firedAt;
    return db.getTime() - da.getTime();
  });

  return (
    <div className="space-y-3">
      {sorted.map((event) => (
        <EventTimelineCard key={event.id} event={event} />
      ))}
    </div>
  );
}
