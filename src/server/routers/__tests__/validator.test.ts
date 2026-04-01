import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

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
    requireSuperAdmin: passthrough,
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

vi.mock("@/server/services/validator", () => ({
  validateConfig: vi.fn(),
}));

import { validatorRouter } from "@/server/routers/validator";
import { validateConfig } from "@/server/services/validator";

const validateConfigMock = validateConfig as ReturnType<typeof vi.fn>;

// We don't actually need prismaMock for this router, but keep the setup consistent
const _prismaMock = (await import("@/lib/prisma")).prisma as unknown as DeepMockProxy<PrismaClient>;

const caller = t.createCallerFactory(validatorRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

describe("validatorRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validate", () => {
    it("returns valid result for correct config", async () => {
      validateConfigMock.mockResolvedValueOnce({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await caller.validate({ yaml: "sources:\n  stdin:\n    type: stdin" });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(validateConfigMock).toHaveBeenCalledWith("sources:\n  stdin:\n    type: stdin");
    });

    it("returns errors for invalid config", async () => {
      validateConfigMock.mockResolvedValueOnce({
        valid: false,
        errors: [{ message: "Invalid component type 'bad_source'", componentKey: "bad_source" }],
        warnings: [],
      });

      const result = await caller.validate({ yaml: "sources:\n  bad_source:\n    type: bad_source" });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Invalid component type");
      expect(result.errors[0].componentKey).toBe("bad_source");
    });
  });
});
