"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { useEnvironmentStore } from "@/stores/environment-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VFIcon } from "@/components/ui/vf-icon";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { toast } from "sonner";
import { AlertRulePreview } from "@/components/alerts/alert-rule-preview";
import { AlertRuleSlackPreview } from "@/components/alerts/alert-rule-slack-preview";

/**
 * Shared alert-rule editor used by both /alerts/new and /alerts/[id]/edit.
 *
 * Wires to:
 *   - trpc.alert.createRule | trpc.alert.updateRule
 *   - trpc.pipeline.list, trpc.alert.listChannels
 */

const SEVERITIES = ["info", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

const METRICS = [
  { value: "error_rate", label: "error_rate" },
  { value: "discarded_rate", label: "discarded_rate" },
  { value: "latency_mean", label: "latency_mean" },
  { value: "throughput_floor", label: "throughput_floor" },
  { value: "cpu_usage", label: "cpu_usage" },
  { value: "memory_usage", label: "memory_usage" },
  { value: "disk_usage", label: "disk_usage" },
] as const;

const CONDITIONS = [
  { value: "gt", label: "is above" },
  { value: "lt", label: "is below" },
  { value: "eq", label: "equals" },
] as const;

export type AlertRuleFormValues = {
  name: string;
  description: string;
  severity: Severity;
  pipelineId: string;
  metric: string;
  condition: string;
  threshold: string;
  durationMinutes: string;
  cooldown: string;
  channelIds: string[];
};

export const DEFAULT_SUGGESTED_ACTION = "Review the alert context, then inspect the affected pipeline, node, and recent deployment changes.";
export const DEFAULT_FORM_VALUES: AlertRuleFormValues = {
  name: "pipeline error rate breach",
  description: "",
  severity: "critical",
  pipelineId: "",
  metric: "error_rate",
  condition: "gt",
  threshold: "5",
  durationMinutes: "5",
  cooldown: "15",
  channelIds: [],
};

export function formValuesFromSearchParams(searchParams: Pick<URLSearchParams, "get">): AlertRuleFormValues {
  const severity = searchParams.get("severity");

  return {
    name: searchParams.get("name") ?? DEFAULT_FORM_VALUES.name,
    description: searchParams.get("description") ?? DEFAULT_FORM_VALUES.description,
    severity: severity === "info" || severity === "warning" || severity === "critical"
      ? severity
      : DEFAULT_FORM_VALUES.severity,
    pipelineId: searchParams.get("pipelineId") ?? DEFAULT_FORM_VALUES.pipelineId,
    metric: searchParams.get("metric") ?? DEFAULT_FORM_VALUES.metric,
    condition: searchParams.get("condition") ?? DEFAULT_FORM_VALUES.condition,
    threshold: searchParams.get("threshold") ?? DEFAULT_FORM_VALUES.threshold,
    durationMinutes: searchParams.get("durationMinutes") ?? DEFAULT_FORM_VALUES.durationMinutes,
    cooldown: searchParams.get("cooldown") ?? DEFAULT_FORM_VALUES.cooldown,
    channelIds: (searchParams.get("channelIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  };
}

type Props =
  | {
      mode: "create";
      initialValues?: AlertRuleFormValues;
    }
  | {
      mode: "edit";
      ruleId: string;
      ruleName: string;
      environmentId: string;
      initialValues: AlertRuleFormValues;
    };

export function AlertRuleForm(props: Props) {
  const trpc = useTRPC();
  const router = useRouter();
  const qc = useQueryClient();
  const teamId = useTeamStore((s) => s.selectedTeamId);
  const { selectedEnvironmentId } = useEnvironmentStore();
  const effectiveEnvironmentId =
    props.mode === "edit" ? props.environmentId : selectedEnvironmentId;

  const initial = props.initialValues ?? DEFAULT_FORM_VALUES;

  const [name, setName] = React.useState(initial.name);
  const [description, setDescription] = React.useState(initial.description);
  const [severity, setSeverity] = React.useState<Severity>(initial.severity);
  const [pipelineId, setPipelineId] = React.useState<string>(initial.pipelineId);
  const [metric, setMetric] = React.useState<string>(initial.metric);
  const [condition, setCondition] = React.useState<string>(initial.condition);
  const [threshold, setThreshold] = React.useState<string>(initial.threshold);
  const [durationMinutes, setDurationMinutes] = React.useState<string>(initial.durationMinutes);
  const [cooldown, setCooldown] = React.useState<string>(initial.cooldown);
  const [enabledChannels, setEnabledChannels] = React.useState<Set<string>>(
    new Set(initial.channelIds),
  );
  const [testRulePending, setTestRulePending] = React.useState(false);
  const previousEnvironmentIdRef = React.useRef(effectiveEnvironmentId);

  React.useEffect(() => {
    if (props.mode !== "create") {
      previousEnvironmentIdRef.current = effectiveEnvironmentId;
      return;
    }

    const previousEnvironmentId = previousEnvironmentIdRef.current;

    if (!effectiveEnvironmentId) {
      return;
    }

    if (previousEnvironmentId && previousEnvironmentId !== effectiveEnvironmentId) {
      setPipelineId("");
      setEnabledChannels(new Set<string>());
    }

    previousEnvironmentIdRef.current = effectiveEnvironmentId;
  }, [effectiveEnvironmentId, props.mode]);

  const pipelinesQ = useQuery({
    ...trpc.pipeline.list.queryOptions({
      environmentId: effectiveEnvironmentId ?? "",
    }),
    enabled: !!effectiveEnvironmentId,
  });
  const channelsQ = useQuery({
    ...trpc.alert.listChannels.queryOptions({
      environmentId: effectiveEnvironmentId ?? "",
    }),
    enabled: !!effectiveEnvironmentId,
  });

  // Surface overlapping rules so users don't accidentally double-author a rule
  // on the same metric + scope. Debounce the inputs that drive scope to avoid
  // hammering the server while the user is still picking pipeline/metric.
  const debouncedMetric = useDebounce(metric, 300);
  const debouncedPipelineId = useDebounce(pipelineId, 300);
  const editRuleId = props.mode === "edit" ? props.ruleId : null;
  const excludeId = editRuleId ?? undefined;
  const similarQ = useQuery({
    ...trpc.alert.findSimilar.queryOptions({
      teamId: teamId ?? "",
      pipelineId: debouncedPipelineId || null,
      environmentId: effectiveEnvironmentId ?? null,
      metric: debouncedMetric as never,
      excludeId,
    }),
    enabled: Boolean(teamId && debouncedMetric),
  });
  const similarMatches = (similarQ.data?.matches ?? []) as Array<{
    id: string;
    name: string;
    metric: string;
    condition: string | null;
    threshold: number | null;
    environment: { id: string; name: string } | null;
    pipeline: { id: string; name: string } | null;
  }>;

  const createRule = useMutation(
    trpc.alert.createRule.mutationOptions({
      onSuccess: () => {
        toast.success("Alert rule created");
        if (effectiveEnvironmentId) {
          qc.invalidateQueries({
            queryKey: trpc.alert.listRules.queryKey({ environmentId: effectiveEnvironmentId }),
          });
        }
        router.push("/alerts");
      },
      onError: (e: { message: string }) => toast.error(e.message),
    }),
  );

  const updateRule = useMutation(
    trpc.alert.updateRule.mutationOptions({
      onSuccess: () => {
        toast.success("Alert rule updated");
        if (effectiveEnvironmentId) {
          qc.invalidateQueries({
            queryKey: trpc.alert.listRules.queryKey({ environmentId: effectiveEnvironmentId }),
          });
        }
        if (editRuleId) {
          qc.invalidateQueries({
            queryKey: trpc.alert.getRule.queryKey({ id: editRuleId, teamId: teamId ?? "" }),
          });
        }
        router.push("/alerts");
      },
      onError: (e: { message: string }) => toast.error(e.message),
    }),
  );

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  function numericOrUndefined(value: string) {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : Number(trimmed);
  }

  function durationMinutesToSeconds(value: string) {
    const minutes = numericOrUndefined(value);
    return minutes === undefined ? undefined : Math.max(1, Math.round(minutes * 60));
  }

  function submit() {
    if (!teamId || (props.mode === "create" && !effectiveEnvironmentId)) {
      toast.error("Select a team and environment");
      return;
    }
    const trimmedDescription = description.trim();
    if (props.mode === "create") {
      createRule.mutate({
        name,
        teamId,
        environmentId: effectiveEnvironmentId!,
        pipelineId: pipelineId || undefined,
        metric: metric as never,
        condition: condition as never,
        description: trimmedDescription || undefined,
        suggestedAction: trimmedDescription || DEFAULT_SUGGESTED_ACTION,
        threshold: numericOrUndefined(threshold),
        durationSeconds: durationMinutesToSeconds(durationMinutes),
        severity,
        cooldownMinutes: numericOrUndefined(cooldown),
        channelIds: Array.from(enabledChannels),
      });
    } else {
      updateRule.mutate({
        id: props.ruleId,
        name,
        description: trimmedDescription,
        suggestedAction: trimmedDescription || DEFAULT_SUGGESTED_ACTION,
        ...(numericOrUndefined(threshold) !== undefined ? { threshold: numericOrUndefined(threshold) } : {}),
        ...(durationMinutesToSeconds(durationMinutes) !== undefined ? { durationSeconds: durationMinutesToSeconds(durationMinutes)! } : {}),
        severity,
        ...(numericOrUndefined(cooldown) !== undefined ? { cooldownMinutes: numericOrUndefined(cooldown) } : {}),
        channelIds: Array.from(enabledChannels),
      });
    }
  }

  async function testRule() {
    if (!teamId) {
      toast.error("Select a team");
      return;
    }

    const rawThreshold = numericOrUndefined(threshold);
    if (rawThreshold !== undefined && !Number.isFinite(rawThreshold)) {
      toast.error("Enter a numeric threshold");
      return;
    }
    const thresholdValue = rawThreshold ?? 0;

    const rawDuration = durationMinutesToSeconds(durationMinutes);
    if (rawDuration !== undefined && !Number.isFinite(rawDuration)) {
      toast.error("Enter a numeric duration");
      return;
    }
    const durationSeconds = rawDuration ?? 0;

    setTestRulePending(true);
    try {
      const result = await qc.fetchQuery(
        trpc.alert.testRule.queryOptions({
          teamId,
          environmentId: effectiveEnvironmentId ?? null,
          pipelineId: pipelineId || null,
          metric: metric as never,
          condition: condition as never,
          threshold: thresholdValue,
          durationSeconds,
          lookbackHours: 6,
        }),
      );

      if (!result.supported) {
        toast.error(result.reason);
        return;
      }

      toast.success(`Rule would have fired ${result.wouldHaveFired} time${result.wouldHaveFired === 1 ? "" : "s"} in the last 6h`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to test rule");
    } finally {
      setTestRulePending(false);
    }
  }

  function cloneAsNewRule() {
    const params = new URLSearchParams({
      name: `Copy of ${name || DEFAULT_FORM_VALUES.name}`,
      description,
      severity,
      pipelineId,
      metric,
      condition,
      threshold,
      durationMinutes,
      cooldown,
      channelIds: Array.from(enabledChannels).join(","),
      environmentId: effectiveEnvironmentId ?? "",
    });

    router.push(`/alerts/new?${params.toString()}`);
  }

  const isPending = props.mode === "create" ? createRule.isPending : updateRule.isPending;
  const breadcrumb =
    props.mode === "create" ? "alerts / new rule" : `alerts / ${props.ruleName} / edit`;
  const heading = props.mode === "create" ? "New alert rule" : "Edit alert rule";
  const submitLabel =
    props.mode === "create"
      ? isPending
        ? "Creating…"
        : "Create rule"
      : isPending
        ? "Saving…"
        : "Save changes";

  const channels = (channelsQ.data ?? []) as { id: string; name: string; type: string }[];
  const pipelines = (pipelinesQ.data?.pipelines ?? []) as { id: string; name: string }[];

  const isEdit = props.mode === "edit";
  const lockedHint = (
    <div className="mt-1 font-mono text-[10.5px] text-fg-2">
      Core definition locked after create. Clone as a new rule to change scope, metric, or condition.
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-bg text-fg">
      {/* HEADER */}
      <div className="px-5 py-4 border-b border-line bg-bg-1 flex items-start justify-between">
        <div>
          <div className="font-mono text-[11px] text-fg-2 tracking-[0.04em]">{breadcrumb}</div>
          <h1 className="m-0 mt-1 font-mono text-[22px] font-medium tracking-[-0.01em]">
            {heading}
          </h1>
          <div className="mt-1 text-[12px] text-fg-2">
            {props.mode === "edit"
              ? "Tune thresholds, severity, notifications, and description. Core definition is locked after creation."
              : "Trigger when a metric crosses a threshold for a sustained window. Rules are evaluated every 30s server-side."}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push("/alerts")}>
            Cancel
          </Button>
          {isEdit && (
            <Button variant="ghost" size="sm" onClick={cloneAsNewRule}>
              Clone as new rule
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={testRule} disabled={testRulePending}>
            <VFIcon name="play" />
            {testRulePending ? "Testing…" : "Test rule"}
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={isPending}>
            <VFIcon name="check" />
            {submitLabel}
          </Button>
        </div>
      </div>

      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: "1fr 440px" }}>
        {/* LEFT — form */}
        <div className="overflow-auto p-6 border-r border-line">
          <div className="max-w-[600px]">
            <FormSection num="1" title="Identity">
              <FormLabel>Name</FormLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
              <div className="mt-1 font-mono text-[10.5px] text-fg-2">
                slug: <span className="text-fg-1">{slug}</span>
              </div>

              <SimilarRulesCallout matches={similarMatches} />


              <FormLabel className="mt-3.5">Description</FormLabel>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[60px] resize-y rounded-[3px] border border-line-2 bg-bg-2 px-2.5 py-2 text-[12px] text-fg outline-none focus-visible:border-accent-brand focus-visible:ring-2 focus-visible:ring-accent-soft"
              />

              <FormLabel className="mt-3.5">Severity</FormLabel>
              <Segmented
                options={SEVERITIES.map((s) => ({ value: s, label: s }))}
                value={severity}
                onChange={(v) => setSeverity(v as Severity)}
                colors={{
                  info: "var(--status-info)",
                  warning: "var(--status-degraded)",
                  critical: "var(--status-error)",
                }}
              />
            </FormSection>

            <FormSection num="2" title="Trigger" sub="evaluate every 30s">
              {isEdit && (
                <div className="mb-3.5 rounded-[3px] border border-line-2 bg-bg-2 px-3 py-2 text-[11.5px] leading-snug text-fg-1">
                  Pipeline, metric, and condition are fixed so historical alert meaning stays stable. Clone this rule to change the core definition.
                </div>
              )}
              <FormLabel>Scope</FormLabel>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <Select
                  label="pipeline"
                  value={pipelineId}
                  onChange={setPipelineId}
                  disabled={isEdit}
                  options={[
                    { value: "", label: "(any)" },
                    ...pipelines.map((p) => ({
                      value: p.id,
                      label: p.name,
                    })),
                  ]}
                />
                <div className="px-2.5 py-2 bg-bg-2 border border-line-2 rounded-[3px] font-mono text-[12px] text-fg-2">
                  environment: {props.mode === "edit" ? "rule environment" : "from topbar"}
                </div>
              </div>
              {isEdit && lockedHint}

              <FormLabel className="mt-3.5">Metric</FormLabel>
              <Select
                value={metric}
                onChange={setMetric}
                disabled={isEdit}
                options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
              />
              {isEdit && lockedHint}

              <FormLabel className="mt-3.5">Condition</FormLabel>
              <div
                className="grid gap-2.5"
                style={{ gridTemplateColumns: "120px 1fr 90px" }}
              >
                <Select
                  value={condition}
                  onChange={setCondition}
                  disabled={isEdit}
                  options={CONDITIONS.map((c) => ({ value: c.value, label: c.label }))}
                />
                <div className="flex items-center bg-bg-2 border border-line-2 rounded-[3px] px-2.5">
                  <input
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    className="flex-1 bg-transparent border-0 outline-none font-mono text-[12px] text-fg py-2"
                  />
                  <span className="font-mono text-[11px] text-fg-2 ml-2">ms</span>
                </div>
                <div className="px-2.5 py-2 bg-bg-2 border border-line-2 rounded-[3px] font-mono text-[12px] text-fg">
                  absolute
                </div>
              </div>
              {isEdit && lockedHint}

              <FormLabel className="mt-3.5">For at least</FormLabel>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="flex items-center bg-bg-2 border border-line-2 rounded-[3px] px-2.5">
                  <input
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    className="flex-1 bg-transparent border-0 outline-none font-mono text-[12px] text-fg py-2"
                  />
                  <span className="font-mono text-[11px] text-fg-2 ml-2">min</span>
                </div>
                <div className="px-2.5 py-2 bg-bg-2 border border-line-2 rounded-[3px] font-mono text-[12px] text-fg">
                  across all nodes
                </div>
              </div>
            </FormSection>

            <FormSection num="3" title="Notify">
              <FormLabel>Channels</FormLabel>
              <div className="flex flex-col gap-1.5">
                {channels.length === 0 && (
                  <div className="px-2.5 py-2 bg-bg-2 border border-line rounded-[3px] font-mono text-[11px] text-fg-2">
                    No channels configured. Add one in settings → notifications.
                  </div>
                )}
                {channels.map((c) => {
                  const on = enabledChannels.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setEnabledChannels((s) => {
                          const n = new Set(s);
                          if (n.has(c.id)) n.delete(c.id);
                          else n.add(c.id);
                          return n;
                        });
                      }}
                      className={cn(
                        "flex items-center gap-2.5 px-2.5 py-2 rounded-[3px] cursor-pointer text-left",
                        on
                          ? "bg-accent-soft border border-accent-line"
                          : "bg-bg-2 border border-line",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center justify-center h-3.5 w-3.5 rounded-[3px] border",
                          on
                            ? "bg-accent-brand border-accent-brand text-primary-foreground"
                            : "border-line-2",
                        )}
                      >
                        {on && <VFIcon name="check" size={10} strokeWidth={2.4} />}
                      </span>
                      <span className="font-mono text-[12px] text-fg flex-1">
                        {c.name} <span className="text-fg-2">· {c.type}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <FormLabel className="mt-3.5">Cooldown</FormLabel>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="flex items-center bg-bg-2 border border-line-2 rounded-[3px] px-2.5">
                  <input
                    value={cooldown}
                    onChange={(e) => setCooldown(e.target.value)}
                    className="flex-1 bg-transparent border-0 outline-none font-mono text-[12px] text-fg py-2"
                  />
                  <span className="font-mono text-[11px] text-fg-2 ml-2">min</span>
                </div>
                <div className="px-2.5 py-2 bg-bg-2 border border-line-2 rounded-[3px] font-mono text-[12px] text-fg">
                  suppress duplicates
                </div>
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-fg-2">
                Won&apos;t fire again for the same scope within {cooldown} minutes.
              </div>
            </FormSection>
          </div>
        </div>

        {/* RIGHT — preview */}
        <div className="bg-bg-1 p-5 overflow-auto">
          <div className="font-mono text-[10px] text-fg-2 tracking-[0.04em] uppercase">
            Rule summary
          </div>
          <div className="mt-2.5 p-3.5 bg-bg-2 border border-line rounded-[3px] font-mono text-[12px] leading-[1.7] text-fg-1">
            When <span className="text-fg">{METRICS.find((m) => m.value === metric)?.label}</span>
            <br />
            on{" "}
            <span className="text-accent-brand">
              {pipelines.find((p) => p.id === pipelineId)?.name ?? "(any pipeline)"}
            </span>
            <br />
            is{" "}
            <span className="text-fg">
              {CONDITIONS.find((c) => c.value === condition)?.label} {threshold}
            </span>
            <br />
            for <span className="text-fg">at least {durationMinutes} minutes</span>
            <br />
            <span className="text-status-error">fire {severity} alert</span>
            <br />
            to{" "}
            <span className="text-fg">
              {enabledChannels.size === 0
                ? "(no channels)"
                : Array.from(enabledChannels)
                    .map((id) => channels.find((c) => c.id === id)?.name)
                    .filter(Boolean)
                    .join(", ")}
            </span>
            <br />
            cooldown <span className="text-fg">{cooldown} min</span>
          </div>

          <div className="mt-4 p-3 bg-[color:var(--status-degraded-bg)] border border-[color:var(--status-degraded)]/33 rounded-[3px] text-[11.5px] text-fg-1 leading-snug">
            <div className="font-mono text-status-degraded font-medium text-[11.5px] mb-1">
              ⚠ note
            </div>
            Server emits an alert event each time this rule fires. Cooldown suppresses
            duplicates per scope.
          </div>

          <AlertRulePreview
            teamId={teamId}
            environmentId={effectiveEnvironmentId ?? null}
            pipelineId={pipelineId}
            metric={metric}
            condition={condition}
            threshold={threshold}
            durationMinutes={durationMinutes}
          />

          <AlertRuleSlackPreview
            name={name}
            severity={severity}
            metric={metric}
            condition={condition}
            threshold={threshold}
            durationSeconds={Math.max(0, Math.round(Number(durationMinutes) * 60))}
            pipelineName={pipelines.find((p) => p.id === pipelineId)?.name ?? null}
          />
        </div>
      </div>
    </div>
  );
}

function SimilarRulesCallout({
  matches,
}: {
  matches: Array<{
    id: string;
    name: string;
    metric: string;
    condition: string | null;
    threshold: number | null;
    environment: { id: string; name: string } | null;
    pipeline: { id: string; name: string } | null;
  }>;
}) {
  if (matches.length === 0) return null;

  const conditionLabel = (c: string | null) => {
    if (c === "gt") return ">";
    if (c === "lt") return "<";
    if (c === "eq") return "=";
    return "";
  };

  return (
    <div className="mt-2.5 bg-status-degraded-bg border-l-[3px] border-l-status-degraded p-3 rounded-[3px]">
      <div className="font-mono text-[11.5px] font-medium text-status-degraded">
        Similar rule(s) already exist
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {matches.map((m) => {
          const scope = m.pipeline?.name ?? m.environment?.name ?? "team-wide";
          const summary =
            m.condition && m.threshold != null
              ? `${m.metric} ${conditionLabel(m.condition)} ${m.threshold}`
              : m.metric;
          return (
            <li key={m.id} className="flex items-center gap-2 leading-snug">
              <Link
                href={`/alerts/${m.id}/edit`}
                className="font-mono text-[12px] text-fg hover:text-accent-brand underline-offset-2 hover:underline"
              >
                {m.name}
              </Link>
              <span className="font-mono text-[10.5px] text-fg-2 px-1.5 py-0.5 rounded-[3px] bg-bg-2 border border-line-2">
                {scope}
              </span>
              <span className="font-mono text-[11px] text-fg-2">· {summary}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FormSection({
  num,
  title,
  sub,
  children,
}: {
  num: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pb-6 mb-6 border-b border-line">
      <div className="flex items-baseline gap-2.5 mb-3.5">
        <span className="inline-flex items-center justify-center h-[22px] w-[22px] rounded-full bg-bg-2 border border-line-2 text-fg-2 font-mono text-[11px] font-medium">
          {num}
        </span>
        <h2 className="m-0 text-[14px] font-medium font-mono text-fg">{title}</h2>
        {sub && <span className="font-mono text-[11px] text-fg-2">· {sub}</span>}
      </div>
      {children}
    </div>
  );
}

function FormLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("font-mono text-[10.5px] text-fg-2 tracking-[0.04em] uppercase mb-1.5", className)}>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center bg-bg-2 border border-line-2 rounded-[3px] px-2.5 py-2 font-mono text-[12px] text-fg",
        disabled && "opacity-60",
      )}
    >
      {label && <span className="text-fg-2 mr-1.5">{label}:</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          "appearance-none bg-transparent border-0 outline-none text-fg pr-5 flex-1",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="absolute right-2.5 text-fg-2 text-[11px] pointer-events-none">▾</span>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
  colors,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  colors?: Record<string, string>;
}) {
  return (
    <div className="inline-flex bg-bg-2 border border-line-2 rounded-[3px] p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        const c = colors?.[o.value] ?? "var(--accent-brand)";
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "px-3.5 py-1 rounded-[3px] font-mono text-[11px] tracking-[0.03em] cursor-pointer border",
              active ? "border-transparent" : "border-transparent text-fg-2",
            )}
            style={
              active
                ? {
                    background: `color-mix(in srgb, ${c} 14%, transparent)`,
                    borderColor: `color-mix(in srgb, ${c} 33%, transparent)`,
                    color: c,
                  }
                : undefined
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
