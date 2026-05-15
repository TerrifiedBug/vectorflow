import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/app/api/v1/_lib/api-handler", () => ({
  apiRoute: (
    _name: string,
    fn: (req: Request, ctx: { environmentId: string }) => Promise<Response>,
  ) => async (req: Request) =>
    fn(req, { environmentId: "env-1" }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findMany: mocks.findMany },
    environment: { findUnique: mocks.findUnique },
  },
}));

import { GET as routeGet } from "../route";
const GET = routeGet as unknown as (req: Request) => Promise<Response>;

function makeReq(query: string): Request {
  return new Request(`http://x/api/v1/audit/export?${query}`);
}

describe("/api/v1/audit/export?format=chain — contiguity guards", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.findUnique.mockReset();
    mocks.findUnique.mockResolvedValue({ organizationId: "org-a" });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects ?action= filter on chain format", async () => {
    const res = await GET(makeReq("format=chain&action=secret.create"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unfiltered/i);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("rejects ?entityType= filter on chain format", async () => {
    const res = await GET(makeReq("format=chain&entityType=Secret"));
    expect(res.status).toBe(400);
  });

  it("rejects ?userId= filter on chain format", async () => {
    const res = await GET(makeReq("format=chain&userId=u-1"));
    expect(res.status).toBe(400);
  });

  it("rejects ?from= time range on chain format", async () => {
    const res = await GET(
      makeReq("format=chain&from=2026-01-01T00:00:00Z"),
    );
    expect(res.status).toBe(400);
  });

  it("accepts unfiltered chain format and orders rows ASC", async () => {
    mocks.findMany.mockResolvedValue([]);
    const res = await GET(makeReq("format=chain"));
    expect(res.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "asc" },
      }),
    );
  });

  it("csv/json formats keep newest-first ordering (no regression)", async () => {
    mocks.findMany.mockResolvedValue([]);
    await GET(makeReq("format=csv"));
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      }),
    );
  });
});
