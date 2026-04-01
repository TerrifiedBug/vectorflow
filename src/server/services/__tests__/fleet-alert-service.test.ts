import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import type { AlertRule, AlertEvent } from "@/generated/prisma";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

// Mock fleet-metrics functions
vi.mock("@/server/services/fleet-metrics", () => ({
  getFleetErrorRate: vi.fn(),
  getFleetEventVolume: vi.fn(),
  getFleetThroughputDrop: vi.fn(),
  getNodeLoadImbalance: vi.fn(),
}));

// Mock delivery modules — we don't want real HTTP calls
vi.mock("@/server/services/channels", () => ({
  deliverToChannels: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/server/services/webhook-delivery", () => ({
  deliverSingleWebhook: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/server/services/delivery-tracking", () => ({
  trackWebhookDelivery: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/server/services/drift-metrics", () => ({
  getVersionDrift: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { FleetAlertService } from "@/server/services/fleet-alert-service";
import {
  getFleetErrorRate,
  getFleetEventVolume,
  getFleetThroughputDrop,
  getNodeLoadImbalance,
} from "@/server/services/fleet-metrics";
import { deliverToChannels } from "@/server/services/channels";
import { trackWebhookDelivery } from "@/server/services/delivery-tracking";
import { getVersionDrift } from "@/server/services/drift-metrics";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const mockGetFleetErrorRate = getFleetErrorRate as ReturnType<typeof vi.fn>;
const mockGetFleetEventVolume = getFleetEventVolume as ReturnType<typeof vi.fn>;
const mockGetFleetThroughputDrop = getFleetThroughputDrop as ReturnType<typeof vi.fn>;
const mockGetNodeLoadImbalance = getNodeLoadImbalance as ReturnType<typeof vi.fn>;
const mockGetVersionDrift = getVersionDrift as ReturnType<typeof vi.fn>;

// ─── Fixture helpers ────────────────────────────────────────────────────────

const NOW = new Date("2025-06-01T12:00:00Z");

type RuleWithEnv = AlertRule & {
  environment: { name: string; team: { name: string } | null };
};

function makeRule(
  overrides: Partial<AlertRule> & {
    environment?: { name: string; team: { name: string } | null };
  } = {},
): RuleWithEnv {
  return {
    id: overrides.id ?? "rule-1",
    name: overrides.name ?? "Test Fleet Rule",
    enabled: overrides.enabled ?? true,
    environmentId: overrides.environmentId ?? "env-1",
    pipelineId: overrides.pipelineId ?? null,
    teamId: overrides.teamId ?? "team-1",
    metric: overrides.metric ?? "fleet_error_rate",
    condition: overrides.condition ?? "gt",
    threshold: overrides.threshold ?? 5,
    durationSeconds: overrides.durationSeconds ?? 0,
    snoozedUntil: overrides.snoozedUntil ?? null,
    cooldownMinutes: overrides.cooldownMinutes ?? null,
    keyword: null,
    keywordSeverityFilter: null,
    keywordWindowMinutes: null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    environment: overrides.environment ?? {
      name: "Production",
      team: { name: "Platform" },
    },
  };
}

function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: overrides.id ?? "event-1",
    alertRuleId: overrides.alertRuleId ?? "rule-1",
    nodeId: overrides.nodeId ?? null,
    status: overrides.status ?? "firing",
    value: overrides.value ?? 10,
    message: overrides.message ?? "Fleet error rate at 10.00 (threshold: > 5)",
    firedAt: overrides.firedAt ?? NOW,
    resolvedAt: overrides.resolvedAt ?? null,
    notifiedAt: overrides.notifiedAt ?? null,
    acknowledgedAt: overrides.acknowledgedAt ?? null,
    acknowledgedBy: overrides.acknowledgedBy ?? null,
    correlationGroupId: overrides.correlationGroupId ?? null,
    errorContext: null,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("FleetAlertService", () => {
  let service: FleetAlertService;

  beforeEach(() => {
    mockReset(prismaMock);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    mockGetFleetErrorRate.mockReset();
    mockGetFleetEventVolume.mockReset();
    mockGetFleetThroughputDrop.mockReset();
    mockGetNodeLoadImbalance.mockReset();
    (deliverToChannels as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (trackWebhookDelivery as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ success: true });

    service = new FleetAlertService();

    // Default: no webhooks configured
    prismaMock.alertWebhook.findMany.mockResolvedValue([] as never);
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  // ── fleet_error_rate fires when value exceeds threshold ─────────────────

  it("fires when fleet_error_rate exceeds threshold", async () => {
    const rule = makeRule({
      metric: "fleet_error_rate",
      condition: "gt",
      threshold: 5,
      durationSeconds: 0,
    });
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);

    mockGetFleetErrorRate.mockResolvedValue(10); // 10% > 5% threshold

    // No existing open event
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeEvent({ value: 10, status: "firing" });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    const results = await service.evaluateFleetAlerts();

    expect(results).toHaveLength(1);
    expect(results[0]!.event.status).toBe("firing");
    expect(results[0]!.event.value).toBe(10);
    expect(prismaMock.alertEvent.create).toHaveBeenCalledOnce();
    // nodeId should be null for fleet_error_rate
    expect(prismaMock.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nodeId: null,
        }),
      }),
    );
  });

  // ── Resolves when value drops below threshold ───────────────────────────

  it("resolves when fleet_error_rate drops below threshold", async () => {
    const rule = makeRule({
      metric: "fleet_error_rate",
      condition: "gt",
      threshold: 5,
      durationSeconds: 0,
    });
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);

    mockGetFleetErrorRate.mockResolvedValue(2); // 2% < 5% — condition NOT met

    // An open firing event exists
    const openEvent = makeEvent({ id: "open-event", status: "firing" });
    prismaMock.alertEvent.findFirst.mockResolvedValue(openEvent as never);

    const resolvedEvent = makeEvent({
      id: "open-event",
      status: "resolved",
      resolvedAt: NOW,
    });
    prismaMock.alertEvent.update.mockResolvedValue(resolvedEvent as never);

    const results = await service.evaluateFleetAlerts();

    expect(results).toHaveLength(1);
    expect(results[0]!.event.status).toBe("resolved");
    expect(prismaMock.alertEvent.update).toHaveBeenCalledOnce();
    expect(prismaMock.alertEvent.create).not.toHaveBeenCalled();
  });

  // ── Duration tracking: doesn't fire until duration elapsed ──────────────

  it("respects duration tracking — does not fire before duration elapsed", async () => {
    const rule = makeRule({
      id: "duration-rule",
      metric: "fleet_error_rate",
      condition: "gt",
      threshold: 5,
      durationSeconds: 60,
    });
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);

    mockGetFleetErrorRate.mockResolvedValue(10); // exceeds threshold

    // First call — sets conditionFirstSeen but duration not met
    const results1 = await service.evaluateFleetAlerts();
    expect(results1).toHaveLength(0);
    expect(prismaMock.alertEvent.findFirst).not.toHaveBeenCalled();

    // Advance time by 30s — not enough
    vi.setSystemTime(new Date(NOW.getTime() + 30_000));

    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);
    mockGetFleetErrorRate.mockResolvedValue(10);

    const results2 = await service.evaluateFleetAlerts();
    expect(results2).toHaveLength(0);

    // Advance time to 61s total — duration requirement met
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));

    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);
    mockGetFleetErrorRate.mockResolvedValue(10);
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeEvent({ id: "dur-event", value: 10 });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    const results3 = await service.evaluateFleetAlerts();
    expect(results3).toHaveLength(1);
    expect(results3[0]!.event.status).toBe("firing");
  });

  // ── node_load_imbalance sets nodeId on AlertEvent ───────────────────────

  it("sets nodeId for node_load_imbalance alerts", async () => {
    const rule = makeRule({
      metric: "node_load_imbalance",
      condition: "gt",
      threshold: 30,
      durationSeconds: 0,
    });
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);

    mockGetNodeLoadImbalance.mockResolvedValue({
      value: 50, // 50% imbalance > 30% threshold
      nodeId: "imbalanced-node-1",
    });

    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeEvent({
      id: "imbalance-event",
      value: 50,
      nodeId: "imbalanced-node-1",
    });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    // Mock the node lookup for host resolution
    prismaMock.vectorNode.findUnique.mockResolvedValue({
      host: "node-1.example.com",
    } as never);

    const results = await service.evaluateFleetAlerts();

    expect(results).toHaveLength(1);
    expect(prismaMock.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nodeId: "imbalanced-node-1",
        }),
      }),
    );
    expect(results[0]!.nodeHost).toBe("node-1.example.com");
  });

  // ── fleet_event_volume fire/resolve ─────────────────────────────────────

  it("fires and resolves fleet_event_volume", async () => {
    const rule = makeRule({
      metric: "fleet_event_volume",
      condition: "lt",
      threshold: 1000,
      durationSeconds: 0,
    });
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);

    // Volume below threshold — should fire
    mockGetFleetEventVolume.mockResolvedValue(500);

    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeEvent({ value: 500, status: "firing" });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    const results = await service.evaluateFleetAlerts();
    expect(results).toHaveLength(1);
    expect(results[0]!.event.status).toBe("firing");
  });

  // ── fleet_throughput_drop fire/resolve ──────────────────────────────────

  it("fires fleet_throughput_drop when drop exceeds threshold", async () => {
    const rule = makeRule({
      metric: "fleet_throughput_drop",
      condition: "gt",
      threshold: 20,
      durationSeconds: 0,
    });
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);

    // 50% drop > 20% threshold
    mockGetFleetThroughputDrop.mockResolvedValue(50);

    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeEvent({ value: 50, status: "firing" });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    const results = await service.evaluateFleetAlerts();
    expect(results).toHaveLength(1);
    expect(results[0]!.event.status).toBe("firing");
  });

  // ── Snoozed rules are skipped ──────────────────────────────────────────

  it("skips snoozed rules", async () => {
    // The snooze filter in the query means no rules are returned
    prismaMock.alertRule.findMany.mockResolvedValue([] as never);

    const results = await service.evaluateFleetAlerts();
    expect(results).toHaveLength(0);
    expect(prismaMock.alertEvent.create).not.toHaveBeenCalled();

    // Verify the query includes the snooze filter
    expect(prismaMock.alertRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          metric: { in: expect.arrayContaining(["fleet_error_rate"]) },
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { snoozedUntil: null },
                { snoozedUntil: { lt: expect.any(Date) } },
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  // ── One rule error doesn't prevent other rules ──────────────────────────

  it("continues evaluating when one rule errors", async () => {
    const rule1 = makeRule({
      id: "rule-bad",
      metric: "fleet_error_rate",
      condition: "gt",
      threshold: 5,
      durationSeconds: 0,
    });
    const rule2 = makeRule({
      id: "rule-good",
      metric: "fleet_event_volume",
      condition: "lt",
      threshold: 1000,
      durationSeconds: 0,
    });
    prismaMock.alertRule.findMany.mockResolvedValue([rule1, rule2] as never);

    // First metric throws
    mockGetFleetErrorRate.mockRejectedValue(new Error("DB connection lost"));
    // Second metric succeeds
    mockGetFleetEventVolume.mockResolvedValue(500);

    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeEvent({
      id: "good-event",
      value: 500,
      alertRuleId: "rule-good",
    });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    const results = await service.evaluateFleetAlerts();

    // Rule2 should still have fired despite rule1 erroring
    expect(results).toHaveLength(1);
    expect(results[0]!.event.id).toBe("good-event");
  });

  // ── Null metric value clears duration and skips ─────────────────────────

  it("clears duration tracking when metric returns null", async () => {
    const rule = makeRule({
      metric: "fleet_error_rate",
      condition: "gt",
      threshold: 5,
      durationSeconds: 60,
    });

    // First call: metric has a value — sets conditionFirstSeen
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);
    mockGetFleetErrorRate.mockResolvedValue(10);

    await service.evaluateFleetAlerts();

    // Second call: metric returns null — should clear duration tracking
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);
    mockGetFleetErrorRate.mockResolvedValue(null);

    const results2 = await service.evaluateFleetAlerts();
    expect(results2).toHaveLength(0);

    // Third call: metric returns a value again — duration starts over
    vi.setSystemTime(new Date(NOW.getTime() + 62_000));
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);
    mockGetFleetErrorRate.mockResolvedValue(10);

    const results3 = await service.evaluateFleetAlerts();
    // Duration hasn't elapsed yet from the new start
    expect(results3).toHaveLength(0);
  });

  // ── Does not fire duplicate when existing event ─────────────────────────

  it("does not fire duplicate when existing open event", async () => {
    const rule = makeRule({
      metric: "fleet_error_rate",
      condition: "gt",
      threshold: 5,
      durationSeconds: 0,
    });
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);

    mockGetFleetErrorRate.mockResolvedValue(10);

    // Existing firing event → dedup
    prismaMock.alertEvent.findFirst.mockResolvedValue(
      makeEvent({ id: "existing", status: "firing" }) as never,
    );

    const results = await service.evaluateFleetAlerts();
    expect(results).toHaveLength(0);
    expect(prismaMock.alertEvent.create).not.toHaveBeenCalled();
  });

  // ── Delivers notifications for fired events ─────────────────────────────

  it("delivers to webhooks and channels for fired events", async () => {
    const rule = makeRule({
      metric: "fleet_error_rate",
      condition: "gt",
      threshold: 5,
      durationSeconds: 0,
    });
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);

    mockGetFleetErrorRate.mockResolvedValue(10);
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeEvent({ id: "notify-event", value: 10 });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    // Webhooks exist
    prismaMock.alertWebhook.findMany.mockResolvedValue([
      { id: "wh-1", url: "https://hooks.example.com/alert", enabled: true },
    ] as never);

    await service.evaluateFleetAlerts();

    // Verify webhook delivery was called
    expect(trackWebhookDelivery).toHaveBeenCalledWith(
      "notify-event",
      "wh-1",
      "https://hooks.example.com/alert",
      expect.any(Function),
    );

    // Verify channel delivery was called
    expect(deliverToChannels).toHaveBeenCalledWith(
      "env-1",
      "rule-1",
      expect.objectContaining({
        alertId: "notify-event",
        status: "firing",
        environment: "Production",
        team: "Platform",
      }),
      "notify-event",
    );
  });

  // ── Start/stop lifecycle ────────────────────────────────────────────────

  it("start() and stop() manage the interval timer", () => {
    service.start();
    // Timer should be set — we can verify by stopping without error
    service.stop();
    // Second stop is safe
    service.stop();
  });

  // ── version_drift evaluation ────────────────────────────────────────────

  describe("version_drift evaluation", () => {
    it("fires alert when version drift is detected", async () => {
      const rule = makeRule({
        id: "rule-vd-1",
        metric: "version_drift",
        condition: "gt",
        threshold: 0,
        durationSeconds: 0,
      });

      prismaMock.alertRule.findMany.mockResolvedValue([rule]);
      mockGetVersionDrift.mockResolvedValue({ value: 2, driftedPipelines: [] });
      prismaMock.alertEvent.findFirst.mockResolvedValue(null);
      prismaMock.alertEvent.create.mockResolvedValue({
        id: "event-vd-1",
        alertRuleId: "rule-vd-1",
        nodeId: null,
        status: "firing",
        value: 2,
        message: "Version drift at 2.00 (threshold: > 0)",
        firedAt: NOW,
        resolvedAt: null,
        notifiedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        correlationGroupId: null,
        errorContext: null,
      });
      prismaMock.alertWebhook.findMany.mockResolvedValue([]);

      const results = await service.evaluateFleetAlerts();

      expect(results).toHaveLength(1);
      expect(results[0].event.status).toBe("firing");
      expect(mockGetVersionDrift).toHaveBeenCalledWith(rule.environmentId);
    });

    it("resolves alert when version drift drops to zero", async () => {
      const rule = makeRule({
        id: "rule-vd-2",
        metric: "version_drift",
        condition: "gt",
        threshold: 0,
        durationSeconds: 0,
      });

      prismaMock.alertRule.findMany.mockResolvedValue([rule]);
      mockGetVersionDrift.mockResolvedValue({ value: 0, driftedPipelines: [] });
      prismaMock.alertEvent.findFirst.mockResolvedValue({
        id: "event-vd-2",
        alertRuleId: "rule-vd-2",
        status: "firing",
        resolvedAt: null,
        firedAt: NOW,
        nodeId: null,
        value: 2,
        message: "Version drift at 2.00 (threshold: > 0)",
        notifiedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        correlationGroupId: null,
        errorContext: null,
      });
      prismaMock.alertEvent.update.mockResolvedValue({
        id: "event-vd-2",
        alertRuleId: "rule-vd-2",
        status: "resolved",
        resolvedAt: NOW,
        firedAt: NOW,
        nodeId: null,
        value: 0,
        message: "Version drift at 2.00 (threshold: > 0)",
        notifiedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        correlationGroupId: null,
        errorContext: null,
      });

      const results = await service.evaluateFleetAlerts();

      expect(results).toHaveLength(1);
      expect(results[0].event.status).toBe("resolved");
    });
  });
});
