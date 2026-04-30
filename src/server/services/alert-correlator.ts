// src/server/services/alert-correlator.ts
import { prisma } from "@/lib/prisma";
import type {
  AlertEvent,
  AlertRule,
  AlertCorrelationGroup,
  AnomalyEvent,
} from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 5-minute correlation window in milliseconds. */
export const CORRELATION_WINDOW_MS = 5 * 60 * 1000;

/** Metrics that indicate a node-level root cause (highest causal priority). */
const NODE_ROOT_CAUSE_METRICS = new Set([
  "node_unreachable",
  "cpu_usage",
  "memory_usage",
  "disk_usage",
]);

// ---------------------------------------------------------------------------
// correlateEvent
// ---------------------------------------------------------------------------

/**
 * Assign a newly-fired AlertEvent to a correlation group.
 *
 * If an open group exists within the correlation window for the same
 * environment, the event joins that group. Otherwise a new group is created.
 *
 * Returns the correlation group (new or existing).
 */
export async function correlateEvent(
  event: AlertEvent,
  rule: AlertRule,
): Promise<AlertCorrelationGroup> {
  const windowStart = new Date(event.firedAt.getTime() - CORRELATION_WINDOW_MS);

  // Look for an open group in the same environment within the time window
  const existingGroup = await prisma.alertCorrelationGroup.findFirst({
    where: {
      environmentId: rule.environmentId,
      status: "firing",
      openedAt: { gte: windowStart },
    },
    orderBy: { openedAt: "desc" },
  });

  if (existingGroup) {
    // Add this event to the existing group
    await prisma.alertCorrelationGroup.update({
      where: { id: existingGroup.id },
      data: { eventCount: { increment: 1 } },
    });

    await prisma.alertEvent.update({
      where: { id: event.id },
      data: { correlationGroupId: existingGroup.id },
    });

    return { ...existingGroup, eventCount: existingGroup.eventCount + 1 };
  }

  // Create a new correlation group with this event as the initial root cause
  const newGroup = await prisma.alertCorrelationGroup.create({
    data: {
      environmentId: rule.environmentId,
      status: "firing",
      rootCauseEventId: event.id,
      eventCount: 1,
    },
  });

  await prisma.alertEvent.update({
    where: { id: event.id },
    data: { correlationGroupId: newGroup.id },
  });

  return newGroup;
}

// ---------------------------------------------------------------------------
// correlateAnomalyEvent
// ---------------------------------------------------------------------------

/**
 * Assign a newly detected AnomalyEvent to a correlation group.
 *
 * Anomalies use the same environment and time-window grouping rule as alert
 * events so the incident timeline can show all signals that fired together.
 */
export async function correlateAnomalyEvent(
  event: AnomalyEvent,
): Promise<AlertCorrelationGroup> {
  const windowStart = new Date(event.detectedAt.getTime() - CORRELATION_WINDOW_MS);

  const existingGroup = await prisma.alertCorrelationGroup.findFirst({
    where: {
      environmentId: event.environmentId,
      status: "firing",
      openedAt: { gte: windowStart },
    },
    orderBy: { openedAt: "desc" },
  });

  if (existingGroup) {
    await prisma.alertCorrelationGroup.update({
      where: { id: existingGroup.id },
      data: { eventCount: { increment: 1 } },
    });

    await prisma.anomalyEvent.update({
      where: { id: event.id },
      data: { correlationGroupId: existingGroup.id },
    });

    return { ...existingGroup, eventCount: existingGroup.eventCount + 1 };
  }

  const newGroup = await prisma.alertCorrelationGroup.create({
    data: {
      environmentId: event.environmentId,
      status: "firing",
      rootCauseEventId: null,
      eventCount: 1,
    },
  });

  await prisma.anomalyEvent.update({
    where: { id: event.id },
    data: { correlationGroupId: newGroup.id },
  });

  return newGroup;
}

// ---------------------------------------------------------------------------
// suggestRootCause
// ---------------------------------------------------------------------------

/**
 * Analyze events in a correlation group and suggest the most likely root cause.
 *
 * Priority order:
 * 1. node_unreachable — a down node causes cascading pipeline alerts
 * 2. Node-level resource exhaustion (cpu_usage, memory_usage, disk_usage)
 * 3. Earliest-firing event — temporal precedence as fallback heuristic
 *
 * Updates the group's rootCauseEventId and rootCauseSuggestion fields.
 * Returns the suggestion string, or null if no events exist.
 */
export async function suggestRootCause(
  groupId: string,
): Promise<string | null> {
  const events = await prisma.alertEvent.findMany({
    where: { correlationGroupId: groupId },
    include: {
      alertRule: true,
      node: { select: { id: true, host: true } },
    },
    orderBy: { firedAt: "asc" },
  });

  if (events.length === 0) return null;

  // Find the best root cause candidate
  let rootCauseEvent = events[0]; // default: earliest
  let suggestion: string;

  // Check for node_unreachable first (highest causal priority)
  const nodeUnreachable = events.find(
    (e) => e.alertRule.metric === "node_unreachable",
  );
  if (nodeUnreachable) {
    rootCauseEvent = nodeUnreachable;
    const host = nodeUnreachable.node?.host ?? "unknown node";
    const otherCount = events.length - 1;
    suggestion = `Likely root cause: node_unreachable on ${host} — this node going down likely triggered ${otherCount} related alert${otherCount !== 1 ? "s" : ""}`;
  } else {
    // Check for node-level resource alerts
    const resourceAlert = events.find(
      (e) =>
        NODE_ROOT_CAUSE_METRICS.has(e.alertRule.metric) &&
        e.alertRule.metric !== "node_unreachable",
    );
    if (resourceAlert) {
      rootCauseEvent = resourceAlert;
      const host = resourceAlert.node?.host ?? "unknown node";
      const metricLabel = resourceAlert.alertRule.metric.replace(/_/g, " ");
      const otherCount = events.length - 1;
      suggestion = `Likely root cause: ${metricLabel} on ${host} (${resourceAlert.alertRule.name}) — resource pressure may have caused ${otherCount} related alert${otherCount !== 1 ? "s" : ""}`;
    } else {
      // Fallback: earliest-firing event
      const host = rootCauseEvent.node?.host ?? "unknown node";
      const otherCount = events.length - 1;
      suggestion = `Earliest alert: ${rootCauseEvent.alertRule.name} on ${host} fired first — ${otherCount} related alert${otherCount !== 1 ? "s" : ""} followed within the correlation window`;
    }
  }

  await prisma.alertCorrelationGroup.update({
    where: { id: groupId },
    data: {
      rootCauseEventId: rootCauseEvent.id,
      rootCauseSuggestion: suggestion,
    },
  });

  return suggestion;
}

// ---------------------------------------------------------------------------
// closeResolvedGroups
// ---------------------------------------------------------------------------

/**
 * Close correlation groups where all member events have been resolved.
 * Called periodically or after alert resolution.
 *
 * Returns the number of groups closed.
 */
export async function closeResolvedGroups(
  environmentId: string,
): Promise<number> {
  const openGroups = await prisma.alertCorrelationGroup.findMany({
    where: {
      environmentId,
      status: "firing",
    },
  });

  let closedCount = 0;

  for (const group of openGroups) {
    // Count signals in this group that are still active.
    const activeAlertCount = await prisma.alertEvent.count({
      where: {
        correlationGroupId: group.id,
        status: { in: ["firing", "acknowledged"] },
      },
    });
    const activeAnomalyCount = await prisma.anomalyEvent.count({
      where: {
        correlationGroupId: group.id,
        status: { in: ["open", "acknowledged"] },
      },
    });

    if (activeAlertCount + activeAnomalyCount === 0) {
      await prisma.alertCorrelationGroup.update({
        where: { id: group.id },
        data: {
          status: "resolved",
          closedAt: new Date(),
        },
      });
      closedCount++;
    }
  }

  return closedCount;
}
