import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Hoist local tRPC instance + vi.fn stubs so vi.mock factories can use them

const { t, ulidGen, sendHeartbeat } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  // vi is available inside vi.hoisted
  return { t, ulidGen: vi.fn(), sendHeartbeat: vi.fn() };
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    requirePlatformOperator: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("ulid", () => ({ ulid: ulidGen }));

vi.mock("@/server/services/telemetry-sender", () => ({
  sendTelemetryHeartbeat: sendHeartbeat,
}));

// ─── Import SUT + mocks after mocks are registered ───────────────────────────

import { prisma } from "@/lib/prisma";
import { telemetryRouter } from "../telemetry";
import { mockOrgSettings } from "@/__tests__/helpers/mock-org-settings";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// Context passed to caller — middleware is passthrough so any shape works
const caller = t.createCallerFactory(telemetryRouter)({
  session: { user: { id: "u1" } },
  organizationId: "default",
});

// ─── Reset mocks between tests ───────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organizationSettings.findUnique.mockResolvedValue(mockOrgSettings());
  prismaMock.organizationSettings.create.mockResolvedValue(mockOrgSettings());
  prismaMock.organizationSettings.upsert.mockResolvedValue(mockOrgSettings());
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("telemetry.get", () => {
  it("returns enabled=false when telemetry is off", async () => {
    prismaMock.organizationSettings.findUnique.mockResolvedValueOnce({
      id: "singleton",
      telemetryEnabled: false,
      telemetryInstanceId: null,
      telemetryEnabledAt: null,
    } as never);

    const result = await caller.get();
    expect(result).toEqual({ enabled: false });
  });

  it("returns enabled=true when telemetry is on", async () => {
    prismaMock.organizationSettings.findUnique.mockResolvedValueOnce({
      id: "singleton",
      telemetryEnabled: true,
      telemetryInstanceId: "01HX0000000000000000000000",
      telemetryEnabledAt: new Date(),
    } as never);

    const result = await caller.get();
    expect(result).toEqual({ enabled: true });
  });
});

describe("telemetry.update", () => {
  it("first-time enable: generates ULID and sets enabledAt", async () => {
    prismaMock.organizationSettings.findUnique.mockResolvedValueOnce({
      id: "singleton",
      telemetryEnabled: false,
      telemetryInstanceId: null,
      telemetryEnabledAt: null,
    } as never);
    ulidGen.mockReturnValueOnce("01HX0000000000000000000000");
    prismaMock.organizationSettings.upsert.mockResolvedValueOnce({} as never);

    await caller.update({ enabled: true });

    expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledTimes(1);
    const args = prismaMock.organizationSettings.upsert.mock.calls[0][0];
    expect(args.update.telemetryEnabled).toBe(true);
    expect(args.update.telemetryInstanceId).toBe("01HX0000000000000000000000");
    expect(args.update.telemetryEnabledAt).toBeInstanceOf(Date);
  });

  it("re-enable preserves instanceId and enabledAt", async () => {
    const existingDate = new Date("2026-04-01T00:00:00.000Z");
    prismaMock.organizationSettings.findUnique.mockResolvedValueOnce({
      id: "singleton",
      telemetryEnabled: false,
      telemetryInstanceId: "01HX0000000000000000000000",
      telemetryEnabledAt: existingDate,
    } as never);
    prismaMock.organizationSettings.upsert.mockResolvedValueOnce({} as never);

    await caller.update({ enabled: true });

    const args = prismaMock.organizationSettings.upsert.mock.calls[0][0];
    expect(args.update.telemetryEnabled).toBe(true);
    expect(args.update.telemetryInstanceId).toBeUndefined();
    expect(args.update.telemetryEnabledAt).toBeUndefined();
    expect(ulidGen).not.toHaveBeenCalled();
  });

  it("disable preserves instanceId and enabledAt", async () => {
    prismaMock.organizationSettings.findUnique.mockResolvedValueOnce({
      id: "singleton",
      telemetryEnabled: true,
      telemetryInstanceId: "01HX0000000000000000000000",
      telemetryEnabledAt: new Date(),
    } as never);
    prismaMock.organizationSettings.upsert.mockResolvedValueOnce({} as never);

    await caller.update({ enabled: false });

    const args = prismaMock.organizationSettings.upsert.mock.calls[0][0];
    expect(args.update.telemetryEnabled).toBe(false);
    expect(args.update.telemetryInstanceId).toBeUndefined();
    expect(args.update.telemetryEnabledAt).toBeUndefined();
  });

  it("first-time enable triggers an immediate background heartbeat", async () => {
    prismaMock.organizationSettings.findUnique.mockResolvedValueOnce({
      id: "singleton",
      telemetryEnabled: false,
      telemetryInstanceId: null,
      telemetryEnabledAt: null,
    } as never);
    ulidGen.mockReturnValueOnce("01HX0000000000000000000000");
    prismaMock.organizationSettings.upsert.mockResolvedValueOnce({} as never);
    sendHeartbeat.mockResolvedValueOnce(undefined);

    await caller.update({ enabled: true });

    await new Promise((r) => setImmediate(r));
    expect(sendHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("disable does not trigger a heartbeat", async () => {
    prismaMock.organizationSettings.findUnique.mockResolvedValueOnce({
      id: "singleton",
      telemetryEnabled: true,
      telemetryInstanceId: "01HX0000000000000000000000",
      telemetryEnabledAt: new Date(),
    } as never);
    prismaMock.organizationSettings.upsert.mockResolvedValueOnce({} as never);

    await caller.update({ enabled: false });
    await new Promise((r) => setImmediate(r));
    expect(sendHeartbeat).not.toHaveBeenCalled();
  });
});
