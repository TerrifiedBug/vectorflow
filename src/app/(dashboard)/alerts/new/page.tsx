"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { useEnvironmentStore } from "@/stores/environment-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VFIcon } from "@/components/ui/vf-icon";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * v2 Alert rule editor (11e) — single-rule create page.
 * Source: docs/internal/VectorFlow 2.0/screens/handoff-surfaces.jsx (ScreenAlertRuleEditor).
 *
 * Wires to:
 *   - trpc.alertRules.createRule (existing)
 *   - trpc.environment.list, trpc.pipeline.list, trpc.alertChannels.listChannels
 */

const SEVERITIES = ["info", "warning", "critical"] as const;
type Severity = (typeof SEVERITIES)[number];

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

export default function NewAlertRulePage() {
  const trpc = useTRPC();
  const router = useRouter();
  const qc = useQueryClient();
  const teamId = useTeamStore((s) => s.selectedTeamId);
  const { selectedEnvironmentId } = useEnvironmentStore();

  const [name, setName] = React.useState("auditbeat p95 latency breach");
  const [description, setDescription] = React.useState(
    "Triggers when p95 latency on auditbeat.logs sustains above SLO.",
  );
  const [severity, setSeverity] = React.useState<Severity>("critical");
  const [pipelineId, setPipelineId] = React.useState<string>("");
  const [metric, setMetric] = React.useState<string>("latency_mean");
  const [condition, setCondition] = React.useState<string>("gt");
  const [threshold, setThreshold] = React.useState<string>("250");
  const [durationMinutes, setDurationMinutes] = React.useState<string>("5");
  const [cooldown, setCooldown] = React.useState<string>("15");

  const pipelinesQ = useQuery({
    ...trpc.pipeline.list.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
    }),
    enabled: !!selectedEnvironmentId,
  });
  const channelsQ = useQuery({
    ...trpc.alertChannels.listChannels.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
    }),
    enabled: !!selectedEnvironmentId,
  });

  const [enabledChannels, setEnabledChannels] = React.useState<Set<string>>(
    new Set(),
  );

  const createRule = useMutation(
    trpc.alertRules.createRule.mutationOptions({
      onSuccess: () => {
        toast.success("Alert rule created");
        qc.invalidateQueries({ queryKey: [["alertRules", "listRules"]] });
        router.push("/alerts");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  function submit() {
    if (!teamId || !selectedEnvironmentId) {
      toast.error("Select a team and environment");
      return;
    }
    createRule.mutate({
      name,
      teamId,
      environmentId: selectedEnvironmentId,
      pipelineId: pipelineId || undefined,
      metric: metric as never,
      condition: condition as never,
      threshold: Number(threshold),
      durationSeconds: Number(durationMinutes) * 60,
      severity,
      cooldownMinutes: Number(cooldown),
      channelIds: Array.from(enabledChannels),
    });
  }

  return (
    <div className="flex flex-col h-full bg-bg text-fg">
      {/* HEADER */}
      <div className="px-5 py-4 border-b border-line bg-bg-1 flex items-start justify-between">
        <div>
          <div className="font-mono text-[11px] text-fg-2 tracking-[0.04em]">
            alerts / new rule
          </div>
          <h1 className="m-0 mt-1 font-mono text-[22px] font-medium tracking-[-0.01em]">
            New alert rule
          </h1>
          <div className="mt-1 text-[12px] text-fg-2">
            Trigger when a metric crosses a threshold for a sustained window. Rules are
            evaluated every 30s server-side.
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push("/alerts")}>
            Cancel
          </Button>
          <Button variant="ghost" size="sm">
            <VFIcon name="play" />
            Test rule
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={createRule.isPending}>
            <VFIcon name="check" />
            {createRule.isPending ? "Creating…" : "Create rule"}
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
              <FormLabel>Scope</FormLabel>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <Select
                  label="pipeline"
                  value={pipelineId}
                  onChange={setPipelineId}
                  options={[
                    { value: "", label: "(any)" },
                    ...((pipelinesQ.data?.pipelines ?? []) as { id: string; name: string }[]).map((p) => ({
                      value: p.id,
                      label: p.name,
                    })),
                  ]}
                />
                <div className="px-2.5 py-2 bg-bg-2 border border-line-2 rounded-[3px] font-mono text-[12px] text-fg-2">
                  environment: from topbar
                </div>
              </div>

              <FormLabel className="mt-3.5">Metric</FormLabel>
              <Select
                value={metric}
                onChange={setMetric}
                options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
              />

              <FormLabel className="mt-3.5">Condition</FormLabel>
              <div
                className="grid gap-2.5"
                style={{ gridTemplateColumns: "120px 1fr 90px" }}
              >
                <Select
                  value={condition}
                  onChange={setCondition}
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
                {(channelsQ.data ?? []).length === 0 && (
                  <div className="px-2.5 py-2 bg-bg-2 border border-line rounded-[3px] font-mono text-[11px] text-fg-2">
                    No channels configured. Add one in settings → notifications.
                  </div>
                )}
                {((channelsQ.data ?? []) as { id: string; name: string; type: string }[]).map(
                  (c) => {
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
                          {c.name}{" "}
                          <span className="text-fg-2">· {c.type}</span>
                        </span>
                      </button>
                    );
                  },
                )}
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
              {(pipelinesQ.data?.pipelines ?? []).find((p) => p.id === pipelineId)?.name ?? "(any pipeline)"}
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
                    .map(
                      (id) =>
                        ((channelsQ.data ?? []) as { id: string; name: string }[]).find(
                          (c) => c.id === id,
                        )?.name,
                    )
                    .join(", ")}
            </span>
            <br />
            cooldown <span className="text-fg">{cooldown} min</span>
          </div>

          <div className="mt-4 p-3 bg-[color:var(--status-degraded-bg)] border border-[color:var(--status-degraded)]/33 rounded-[3px] text-[11.5px] text-fg-1 leading-snug">
            <div className="font-mono text-status-degraded font-medium text-[11.5px] mb-1">
              ⚠ note
            </div>
            Server emits an alert event each time this rule fires. Cooldown
            suppresses duplicates per scope.
          </div>
        </div>
      </div>
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
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
}) {
  return (
    <div className="relative flex items-center bg-bg-2 border border-line-2 rounded-[3px] px-2.5 py-2 font-mono text-[12px] text-fg">
      {label && <span className="text-fg-2 mr-1.5">{label}:</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent border-0 outline-none text-fg pr-5 cursor-pointer flex-1"
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
