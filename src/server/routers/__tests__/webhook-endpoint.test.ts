import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { AlertMetric } from "@/generated/prisma";

// ─── vi.hoisted so `t` is available inside vi.mock factories ────────────────

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/crypto", () => ({
  encrypt: vi.fn().mockReturnValue("encrypted-secret"),
  decrypt: vi.fn().mockReturnValue("plaintext-secret"),
}));

vi.mock("@/server/services/url-validation", () => ({
  validatePublicUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/outbound-webhook", () => ({
  deliverOutboundWebhook: vi.fn().mockResolvedValue({
    success: true,
    statusCode: 200,
    isPermanent: false,
  }),
}));

// ─── Import SUT + mocks after vi.mock ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { webhookEndpointRouter } from "@/server/routers/webhook-endpoint";
import * as cryptoMod from "@/server/services/crypto";
import * as urlValidation from "@/server/services/url-validation";
import * as outboundWebhook from "@/server/services/outbound-webhook";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(webhookEndpointRouter)({
  session: { user: { id: "user-1" } },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<{
  id: string;
  teamId: string;
  name: string;
  url: string;
  eventTypes: AlertMetric[];
  encryptedSecret: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: "ep-1",
    teamId: "team-1",
    name: "My Webhook",
    url: "https://example.com/hook",
    eventTypes: [AlertMetric.deploy_completed],
    encryptedSecret: "encrypted-secret",
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("webhookEndpointRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    vi.mocked(urlValidation.validatePublicUrl).mockResolvedValue(undefined);
    vi.mocked(cryptoMod.encrypt).mockReturnValue("encrypted-secret");
  });

  // ─── create ────────────────────────────────────────────────────────────

  describe("create", () => {
    it("encrypts secret before storing", async () => {
      const endpoint = makeEndpoint();
      prismaMock.webhookEndpoint.create.mockResolvedValue(endpoint);

      await caller.create({
        teamId: "team-1",
        name: "My Webhook",
        url: "https://example.com/hook",
        eventTypes: [AlertMetric.deploy_completed],
        secret: "my-secret",
      });

      expect(cryptoMod.encrypt).toHaveBeenCalledWith("my-secret");
      expect(prismaMock.webhookEndpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            encryptedSecret: "encrypted-secret",
          }),
        }),
      );
    });

    it("validates URL via validatePublicUrl", async () => {
      const endpoint = makeEndpoint();
      prismaMock.webhookEndpoint.create.mockResolvedValue(endpoint);

      await caller.create({
        teamId: "team-1",
        name: "My Webhook",
        url: "https://example.com/hook",
        eventTypes: [AlertMetric.deploy_completed],
      });

      expect(urlValidation.validatePublicUrl).toHaveBeenCalledWith("https://example.com/hook");
    });

    it("stores null encryptedSecret when no secret provided", async () => {
      const endpoint = makeEndpoint({ encryptedSecret: null });
      prismaMock.webhookEndpoint.create.mockResolvedValue(endpoint);

      await caller.create({
        teamId: "team-1",
        name: "My Webhook",
        url: "https://example.com/hook",
        eventTypes: [AlertMetric.deploy_completed],
      });

      expect(prismaMock.webhookEndpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            encryptedSecret: null,
          }),
        }),
      );
    });
  });

  // ─── list ──────────────────────────────────────────────────────────────

  describe("list", () => {
    it("excludes encryptedSecret from response using select", async () => {
      prismaMock.webhookEndpoint.findMany.mockResolvedValue([]);

      await caller.list({ teamId: "team-1" });

      expect(prismaMock.webhookEndpoint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.objectContaining({
            encryptedSecret: expect.anything(),
          }),
        }),
      );
    });

    it("orders by createdAt desc", async () => {
      prismaMock.webhookEndpoint.findMany.mockResolvedValue([]);

      await caller.list({ teamId: "team-1" });

      expect(prismaMock.webhookEndpoint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: "desc" },
        }),
      );
    });
  });

  // ─── testDelivery ──────────────────────────────────────────────────────

  describe("testDelivery", () => {
    it("calls deliverOutboundWebhook with endpoint URL and encrypted secret", async () => {
      const endpoint = makeEndpoint();
      prismaMock.webhookEndpoint.findFirst.mockResolvedValue(endpoint);

      await caller.testDelivery({ id: "ep-1", teamId: "team-1" });

      expect(outboundWebhook.deliverOutboundWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          url: endpoint.url,
          encryptedSecret: endpoint.encryptedSecret,
        }),
        expect.objectContaining({
          type: "test",
        }),
      );
    });

    it("returns the delivery result", async () => {
      const endpoint = makeEndpoint();
      prismaMock.webhookEndpoint.findFirst.mockResolvedValue(endpoint);

      const result = await caller.testDelivery({ id: "ep-1", teamId: "team-1" });

      expect(result).toMatchObject({
        success: true,
        statusCode: 200,
      });
    });
  });

  // ─── listDeliveries ────────────────────────────────────────────────────

  describe("listDeliveries", () => {
    it("returns deliveries ordered by requestedAt desc", async () => {
      prismaMock.webhookEndpoint.findFirst.mockResolvedValue(makeEndpoint());
      prismaMock.webhookDelivery.findMany.mockResolvedValue([]);
      prismaMock.webhookDelivery.count.mockResolvedValue(0);

      await caller.listDeliveries({
        webhookEndpointId: "ep-1",
        teamId: "team-1",
      });

      expect(prismaMock.webhookDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { requestedAt: "desc" },
        }),
      );
    });

    it("returns total count for pagination", async () => {
      prismaMock.webhookEndpoint.findFirst.mockResolvedValue(makeEndpoint());
      prismaMock.webhookDelivery.findMany.mockResolvedValue([]);
      prismaMock.webhookDelivery.count.mockResolvedValue(5);

      const result = await caller.listDeliveries({
        webhookEndpointId: "ep-1",
        teamId: "team-1",
      });

      expect(result.total).toBe(5);
    });
  });
});
