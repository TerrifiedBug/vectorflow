/**
 * A tRPC call against a suspended organization MUST return HTTP 423
 * (Locked), not 403 (Forbidden). The mapping is wired by the `responseMeta`
 * callback in `src/app/api/trpc/[trpc]/route.ts`, which detects the
 * `OrgSuspendedError` sentinel attached as `cause` to the `TRPCError` thrown by
 * `orgProcedure`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map<string, string>()),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

// Import after the mocks are registered.
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  OrgSuspendedError,
  createContext,
  isCallerOrgSuspended,
  orgProcedure,
  router,
} from "@/trpc/init";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const authMock = auth as unknown as ReturnType<typeof vi.fn>;

const SUSPENDED_ORG_ID = "org-suspended";
const ACTIVE_ORG_ID = "org-active";
const USER_ID = "user-1";

// Minimal router that exercises orgProcedure. We don't want to import the real
// appRouter — it pulls in every service module and would bloat this test.
const testRouter = router({
  ping: orgProcedure.query(() => "pong"),
});

function makeHandler() {
  return (req: Request) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router: testRouter,
      createContext,
      responseMeta({ errors }) {
        // Same logic that `src/app/api/trpc/[trpc]/route.ts` uses; we replicate
        // it here to test the policy as a unit rather than mounting the full
        // appRouter.
        if (errors.some((e) => e.cause instanceof OrgSuspendedError)) {
          return { status: 423 };
        }
        return {};
      },
    });
}

function makePingRequest() {
  return new Request("http://localhost/api/trpc/ping", {
    method: "GET",
    headers: { "x-trpc-source": "client" },
  });
}

describe("orgProcedure suspension -> HTTP 423", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockReset();
    authMock.mockResolvedValue({
      user: { id: USER_ID, email: "u@example.com" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns HTTP 423 Locked when the caller's organization is suspended", async () => {
    prismaMock.orgMember.findFirst.mockResolvedValueOnce({
      organizationId: SUSPENDED_ORG_ID,
      role: "OWNER",
    } as never);
    prismaMock.organization.findUnique.mockResolvedValueOnce({
      suspendedAt: new Date("2026-05-01"),
      deletedAt: null,
    } as never);

    const handler = makeHandler();
    const res = await handler(makePingRequest());

    expect(res.status).toBe(423);
    const body = await res.json();
    // tRPC error envelope under superjson:
    //   { error: { json: { message, code, data: { code: "FORBIDDEN", ... } } } }
    const errJson = body.error?.json ?? body.error;
    expect(errJson?.data?.code).toBe("FORBIDDEN");
    expect(String(errJson?.message ?? "")).toMatch(/suspended/i);
  });

  it("returns HTTP 200 when the organization is active", async () => {
    prismaMock.orgMember.findFirst.mockResolvedValueOnce({
      organizationId: ACTIVE_ORG_ID,
      role: "OWNER",
    } as never);
    prismaMock.organization.findUnique.mockResolvedValueOnce({
      suspendedAt: null,
      deletedAt: null,
    } as never);

    const handler = makeHandler();
    const res = await handler(makePingRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    // superjson wraps result data as `{ json: <value> }`.
    const data = body.result?.data;
    const value =
      data && typeof data === "object" && "json" in (data as Record<string, unknown>)
        ? (data as { json: unknown }).json
        : data;
    expect(value).toBe("pong");
  });

  it("returns HTTP 404 when the organization is soft-deleted (precedence)", async () => {
    prismaMock.orgMember.findFirst.mockResolvedValueOnce({
      organizationId: ACTIVE_ORG_ID,
      role: "OWNER",
    } as never);
    prismaMock.organization.findUnique.mockResolvedValueOnce({
      suspendedAt: new Date(),
      deletedAt: new Date(),
    } as never);

    const handler = makeHandler();
    const res = await handler(makePingRequest());

    // NOT_FOUND maps to 404; deleted takes precedence over suspended.
    expect(res.status).toBe(404);
  });

  it("OrgSuspendedError is the cause threaded through the TRPCError", () => {
    const cause = new OrgSuspendedError();
    const err = new TRPCError({
      code: "FORBIDDEN",
      message: "Organization is suspended",
      cause,
    });
    expect(err.cause).toBeInstanceOf(OrgSuspendedError);
    expect((err.cause as OrgSuspendedError)._tag).toBe("OrgSuspendedError");
  });
});

describe("isCallerOrgSuspended (streaming-client path)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockReset();
  });

  it("returns false for an unauthenticated request", async () => {
    authMock.mockResolvedValue(null);
    await expect(isCallerOrgSuspended()).resolves.toEqual({
      suspended: false,
      deleted: false,
    });
  });

  it("returns false for the OSS default org (suspension applies to non-default orgs only)", async () => {
    authMock.mockResolvedValue({ user: { id: USER_ID, email: "u@example.com" } });
    // Both findFirst calls return null → falls through to DEFAULT_ORG_ID.
    prismaMock.orgMember.findFirst.mockResolvedValue(null);
    await expect(isCallerOrgSuspended()).resolves.toEqual({
      suspended: false,
      deleted: false,
    });
    // No organization lookup for the default org.
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it("returns true when the caller's resolved org has suspendedAt set", async () => {
    authMock.mockResolvedValue({ user: { id: USER_ID, email: "u@example.com" } });
    prismaMock.orgMember.findFirst.mockResolvedValueOnce({
      organizationId: SUSPENDED_ORG_ID,
    } as never);
    prismaMock.organization.findUnique.mockResolvedValueOnce({
      suspendedAt: new Date("2026-05-01"),
    } as never);

    await expect(isCallerOrgSuspended()).resolves.toEqual({
      suspended: true,
      deleted: false,
    });
  });

  it("returns false when the caller's org is active", async () => {
    authMock.mockResolvedValue({ user: { id: USER_ID, email: "u@example.com" } });
    prismaMock.orgMember.findFirst.mockResolvedValueOnce({
      organizationId: ACTIVE_ORG_ID,
    } as never);
    prismaMock.organization.findUnique.mockResolvedValueOnce({
      suspendedAt: null,
    } as never);

    await expect(isCallerOrgSuspended()).resolves.toEqual({
      suspended: false,
      deleted: false,
    });
  });

  it("preserves deleted-precedence: deleted org returns deleted=true, suspended=false", async () => {
    authMock.mockResolvedValue({ user: { id: USER_ID, email: "u@example.com" } });
    prismaMock.orgMember.findFirst.mockResolvedValueOnce({
      organizationId: SUSPENDED_ORG_ID,
    } as never);
    prismaMock.organization.findUnique.mockResolvedValueOnce({
      suspendedAt: new Date(),
      deletedAt: new Date(), // both set; deleted wins
    } as never);

    await expect(isCallerOrgSuspended()).resolves.toEqual({
      suspended: false,
      deleted: true,
    });
  });
});
