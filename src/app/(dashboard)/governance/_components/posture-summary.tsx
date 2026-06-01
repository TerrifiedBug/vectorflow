"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

type Posture = inferRouterOutputs<AppRouter>["governance"]["report"]["posture"];
type SignalStatus = Posture["signals"][number]["status"];

const signalTone: Record<SignalStatus, "healthy" | "degraded" | "error"> = {
  healthy: "healthy",
  warning: "degraded",
  critical: "error",
};

const signalLabel: Record<SignalStatus, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
};

function scoreTone(score: number): "healthy" | "degraded" | "error" {
  if (score >= 90) return "healthy";
  if (score >= 65) return "degraded";
  return "error";
}

export function PostureSummary({ posture }: { posture: Posture }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Governance posture</CardTitle>
            <CardDescription>
              Aggregate identity, RBAC, audit, and DLP signals for the selected team.
            </CardDescription>
          </div>
          <StatusBadge variant={scoreTone(posture.score)} className="text-sm">
            {posture.score}/100
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {posture.signals.map((signal) => (
          <div
            key={signal.id}
            className="flex items-start justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0"
          >
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-fg">{signal.label}</p>
              <p className="text-xs text-muted-foreground">{signal.detail}</p>
            </div>
            <StatusBadge variant={signalTone[signal.status]}>
              {signalLabel[signal.status]}
            </StatusBadge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
