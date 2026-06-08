import { adminPrisma, prisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import { runWithOrgContext } from "@/lib/org-context";
import { debugLog, infoLog, errorLog } from "@/lib/logger";
import { isLeader } from "@/server/services/leader-election";
import type { LakeAlertRule } from "@/generated/prisma";
import { isLakeEnabled } from "./clickhouse";
import { aggregateValue, type LakeAggFunction } from "./lake-query";
import { deliverToChannelById } from "@/server/services/channels";
import type { ChannelDeliveryResult, ChannelPayload } from "@/server/services/channels/types";

/**
 * VectorFlow Lake — scheduled threshold alerts (A6).
 *
 * A saved summarize/search spec is evaluated on a cadence; when the aggregate
 * value over the rule's window crosses `threshold`, the rule fires (edge-
 * triggered) via a notification channel. Idempotent and best-effort: a single
 * rule's failure is logged and never aborts the rest of the tick, and the whole
 * service no-ops when the lake is disabled (mirrors `runLakeMigrations`).
 */

/** Tick cadence; each rule still honours its own `intervalSeconds` via `isRuleDue`. */
const POLL_INTERVAL_MS = 60_000;

export type LakeAlertComparator = "GT" | "GTE" | "LT" | "LTE";
export const LAKE_ALERT_COMPARATORS: readonly LakeAlertComparator[] = [
  "GT",
  "GTE",
  "LT",
  "LTE",
];

/** The saved query a rule evaluates. Persisted as `LakeAlertRule.spec` (Json). */
export interface LakeAlertSpec {
  eventType?: "log" | "metric" | "trace";
  query?: string;
  /** Stored for fidelity/future per-series alerts; the v1 evaluator is scalar. */
  groupBy?: string;
  metric: LakeAggFunction;
  metricField?: string;
  windowSeconds: number;
}

export interface LakeAlertEvalResult {
  evaluated: number;
  fired: number;
  resolved: number;
}

export interface LakeAlertTestResult {
  value: number | null;
  delivered: boolean;
}

type RuleOutcome = "fired" | "resolved" | "unchanged";

/**
 * Parse + sanity-check the JSON spec stored on a rule. Returns null when the
 * spec is malformed so the tick skips the rule instead of crashing.
 */
export function parseLakeAlertSpec(raw: unknown): LakeAlertSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const metric = s.metric;
  const windowSeconds = s.windowSeconds;
  if (typeof metric !== "string") return null;
  if (typeof windowSeconds !== "number" || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return null;
  }
  return {
    eventType:
      s.eventType === "log" || s.eventType === "metric" || s.eventType === "trace"
        ? s.eventType
        : undefined,
    query: typeof s.query === "string" ? s.query : undefined,
    groupBy: typeof s.groupBy === "string" ? s.groupBy : undefined,
    metric: metric as LakeAggFunction,
    metricField: typeof s.metricField === "string" ? s.metricField : undefined,
    windowSeconds,
  };
}

/** True iff `value` crosses `threshold` under the comparator. */
export function comparatorCrosses(value: number, comparator: string, threshold: number): boolean {
  switch (comparator) {
    case "GT":
      return value > threshold;
    case "GTE":
      return value >= threshold;
    case "LT":
      return value < threshold;
    case "LTE":
      return value <= threshold;
    default:
      return false;
  }
}

/** Whether a rule is due now (honours its own `intervalSeconds`). */
export function isRuleDue(
  rule: Pick<LakeAlertRule, "lastEvaluatedAt" | "intervalSeconds">,
  now: Date,
): boolean {
  if (!rule.lastEvaluatedAt) return true;
  return now.getTime() - rule.lastEvaluatedAt.getTime() >= rule.intervalSeconds * 1000;
}

function metricLabel(spec: LakeAlertSpec): string {
  return spec.metric === "count" ? "count" : `${spec.metric}(${spec.metricField ?? "?"})`;
}

function buildPayload(
  rule: LakeAlertRule,
  spec: LakeAlertSpec,
  value: number,
  status: "firing" | "resolved",
  now: Date,
): ChannelPayload {
  const label = metricLabel(spec);
  return {
    alertId: `lake:${rule.id}`,
    status,
    ruleName: rule.name,
    severity: "warning",
    environment: rule.environmentId,
    pipeline: rule.pipelineId,
    metric: label,
    value,
    threshold: rule.threshold,
    message:
      status === "firing"
        ? `Lake alert "${rule.name}": ${label} ${rule.comparator} ${rule.threshold} (value=${value})`
        : `Lake alert "${rule.name}" resolved: ${label}=${value}`,
    timestamp: now.toISOString(),
    dashboardUrl: "/lake",
  };
}

async function dispatch(
  rule: LakeAlertRule,
  spec: LakeAlertSpec,
  value: number,
  status: "firing" | "resolved",
  now: Date,
): Promise<ChannelDeliveryResult | null> {
  if (!rule.channelId) return null; // evaluate-only rule
  try {
    return await deliverToChannelById(rule.channelId, rule.environmentId, buildPayload(rule, spec, value, status, now));
  } catch (err) {
    errorLog("lake-alert", `rule=${rule.id} channel dispatch failed`, err);
    return null;
  }
}

interface PersistState {
  lastEvaluatedAt: Date;
  lastValue?: number | null;
  firing?: boolean;
  lastFiredAt?: Date;
}

async function persistState(rule: Pick<LakeAlertRule, "id" | "organizationId">, data: PersistState): Promise<void> {
  await withOrgTx(rule.organizationId, (tx) =>
    tx.lakeAlertRule.update({ where: { id: rule.id }, data }),
  );
}

async function evaluateRule(rule: LakeAlertRule, now: Date): Promise<RuleOutcome> {
  const spec = parseLakeAlertSpec(rule.spec);
  if (!spec) {
    errorLog("lake-alert", `rule=${rule.id} has a malformed spec; stamping lastEvaluatedAt and skipping`);
    await persistState(rule, { lastEvaluatedAt: now });
    return "unchanged";
  }

  const from = new Date(now.getTime() - spec.windowSeconds * 1000);
  const value = await aggregateValue({
    orgId: rule.organizationId,
    pipelineId: rule.pipelineId,
    from,
    to: now,
    eventType: spec.eventType,
    query: spec.query,
    metric: spec.metric,
    metricField: spec.metricField,
  });

  // Undefined aggregate (e.g. avg over no numeric values): record the tick but
  // leave firing state untouched so we never fire/resolve on "no data".
  if (value === null) {
    await persistState(rule, { lastEvaluatedAt: now, lastValue: null });
    return "unchanged";
  }

  const crossing = comparatorCrosses(value, rule.comparator, rule.threshold);
  let outcome: RuleOutcome = "unchanged";
  if (crossing && !rule.firing) outcome = "fired";
  else if (!crossing && rule.firing) outcome = "resolved";

  await persistState(rule, {
    lastEvaluatedAt: now,
    lastValue: value,
    firing: crossing,
    ...(outcome === "fired" ? { lastFiredAt: now } : {}),
  });

  if (outcome !== "unchanged") {
    await dispatch(rule, spec, value, outcome === "fired" ? "firing" : "resolved", now);
  }
  return outcome;
}

/**
 * Evaluate every due, enabled lake alert rule across all orgs. Cross-tenant
 * read via `adminPrisma`; each rule is processed inside its own org context so
 * channel lookups + state writes are RLS-scoped. No-op when the lake is
 * disabled.
 */
export async function evaluateLakeAlertRules(now: Date = new Date()): Promise<LakeAlertEvalResult> {
  const result: LakeAlertEvalResult = { evaluated: 0, fired: 0, resolved: 0 };
  if (!isLakeEnabled()) return result;

  let rules: LakeAlertRule[];
  try {
    rules = await adminPrisma.lakeAlertRule.findMany({ where: { enabled: true } });
  } catch (err) {
    errorLog("lake-alert", "Failed to list lake alert rules (skipping tick)", err);
    return result;
  }

  for (const rule of rules) {
    if (!isRuleDue(rule, now)) continue;
    try {
      const outcome = await runWithOrgContext(rule.organizationId, () => evaluateRule(rule, now));
      result.evaluated += 1;
      if (outcome === "fired") result.fired += 1;
      else if (outcome === "resolved") result.resolved += 1;
    } catch (err) {
      errorLog("lake-alert", `rule=${rule.id} evaluation error (continuing)`, err);
    }
  }
  return result;
}

/**
 * Evaluate a single rule on demand and dispatch a test "firing" notification to
 * its channel (regardless of threshold) so operators can verify wiring. Must be
 * called inside the rule's org context (the tRPC procedure provides it).
 */
export async function testFireLakeAlertRule(args: {
  ruleId: string;
  orgId: string;
}): Promise<LakeAlertTestResult> {
  const rule = await prisma.lakeAlertRule.findFirst({
    where: { id: args.ruleId, organizationId: args.orgId },
  });
  if (!rule) throw new Error("Lake alert rule not found");
  const spec = parseLakeAlertSpec(rule.spec);
  if (!spec) throw new Error("Lake alert rule has a malformed spec");

  const now = new Date();
  const from = new Date(now.getTime() - spec.windowSeconds * 1000);
  const value = await aggregateValue({
    orgId: args.orgId,
    pipelineId: rule.pipelineId,
    from,
    to: now,
    eventType: spec.eventType,
    query: spec.query,
    metric: spec.metric,
    metricField: spec.metricField,
  });

  const delivery = await dispatch(rule, spec, value ?? 0, "firing", now);
  return { value, delivered: delivery?.success ?? false };
}

// ── Scheduler ────────────────────────────────────────────────────────────────
let timer: NodeJS.Timeout | null = null;
let tickInFlight = false;

async function tick(): Promise<void> {
  // SC-3: re-check leadership each tick. A demoted leader's setInterval keeps
  // firing for up to one TTL (~15s) after Redis renewals fail; without this
  // guard the old + new leader both evaluate lake alert rules, double-firing.
  // Guard only — the timer stays so it resumes if leadership is re-acquired.
  if (!isLeader()) {
    debugLog("lake-alert", "Skipping tick — instance is no longer leader");
    return;
  }
  if (tickInFlight) return; // setInterval does not skip overlapping callbacks
  tickInFlight = true;
  try {
    const r = await evaluateLakeAlertRules();
    if (r.fired > 0 || r.resolved > 0) {
      infoLog("lake-alert", `tick: evaluated=${r.evaluated} fired=${r.fired} resolved=${r.resolved}`);
    }
  } catch (err) {
    errorLog("lake-alert", "tick failed", err);
  } finally {
    tickInFlight = false;
  }
}

/**
 * Start the leader-gated lake alert scheduler. No-op when the lake is disabled,
 * so enabling the lake is env-only (matches `runLakeMigrations`). Idempotent.
 */
export function initLakeAlertScheduler(): void {
  if (!isLakeEnabled()) {
    infoLog("lake-alert", "Lake disabled — alert scheduler not started");
    return;
  }
  if (timer) return;
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  timer.unref();
  infoLog("lake-alert", `Alert scheduler started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopLakeAlertScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
