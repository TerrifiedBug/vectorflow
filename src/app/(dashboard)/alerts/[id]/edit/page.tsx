"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import {
  AlertRuleForm,
  DEFAULT_FORM_VALUES,
  type AlertRuleFormValues,
  type Severity,
} from "@/components/alerts/alert-rule-form";
import { Button } from "@/components/ui/button";

/**
 * v2 Alert rule editor — edit page.
 *
 * Mirrors /alerts/new, but prefills from `trpc.alert.getRule` and submits via updateRule.
 */
export default function EditAlertRulePage() {
  const trpc = useTRPC();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const teamId = useTeamStore((s) => s.selectedTeamId);

  const ruleQ = useQuery({
    ...trpc.alert.getRule.queryOptions({
      id: params.id,
      teamId: teamId ?? "",
    }),
    enabled: !!teamId && !!params.id,
    retry: false,
  });

  if (!teamId) {
    return (
      <CenteredMessage>
        <div className="font-mono text-[12px] text-fg-2">Select a team to edit alert rules.</div>
      </CenteredMessage>
    );
  }

  if (ruleQ.isLoading) {
    return (
      <CenteredMessage>
        <div className="font-mono text-[12px] text-fg-2">Loading rule…</div>
      </CenteredMessage>
    );
  }

  if (ruleQ.isError || !ruleQ.data) {
    const notFound =
      ruleQ.error && (ruleQ.error as { data?: { code?: string } }).data?.code === "NOT_FOUND";
    return (
      <CenteredMessage>
        <div className="font-mono text-[14px] text-fg mb-2">
          {notFound ? "Alert rule not found" : "Failed to load rule"}
        </div>
        <div className="font-mono text-[11px] text-fg-2 mb-4">
          {notFound
            ? "The rule may have been deleted or belongs to another team."
            : ruleQ.error?.message ?? "Unknown error"}
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/alerts")}>
          Back to alerts
        </Button>
      </CenteredMessage>
    );
  }

  const initialValues = mapRuleToFormValues(ruleQ.data);

  return (
    <AlertRuleForm
      mode="edit"
      ruleId={ruleQ.data.id}
      ruleName={ruleQ.data.name}
      environmentId={ruleQ.data.environmentId}
      initialValues={initialValues}
    />
  );
}

type RuleFromApi = {
  id: string;
  name: string;
  pipelineId: string | null;
  metric: string;
  condition: string | null;
  threshold: number | null;
  durationSeconds: number | null;
  severity: string;
  suggestedAction: string;
  cooldownMinutes: number | null;
  channels: { channelId: string }[];
};

function mapRuleToFormValues(rule: RuleFromApi): AlertRuleFormValues {
  const severity: Severity =
    rule.severity === "info" || rule.severity === "warning" || rule.severity === "critical"
      ? rule.severity
      : "warning";
  return {
    name: rule.name,
    description: rule.suggestedAction || DEFAULT_FORM_VALUES.description,
    severity,
    pipelineId: rule.pipelineId ?? "",
    metric: rule.metric,
    condition: rule.condition ?? "gt",
    threshold: rule.threshold != null ? String(rule.threshold) : "",
    durationMinutes: rule.durationSeconds != null ? formatDurationMinutes(rule.durationSeconds) : "",
    cooldown: rule.cooldownMinutes != null ? String(rule.cooldownMinutes) : "",
    channelIds: rule.channels.map((c) => c.channelId),
  };
}

function formatDurationMinutes(durationSeconds: number): string {
  if (durationSeconds % 60 === 0) return String(durationSeconds / 60);
  return String(durationSeconds / 60);
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full items-center justify-center bg-bg text-fg p-8">
      {children}
    </div>
  );
}
