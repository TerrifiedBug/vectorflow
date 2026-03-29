import { vi, describe, it, expect } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { GET } from "../route";
import { prisma } from "@/lib/prisma";

describe("GET /api/health", () => {
  it("returns { status: 'ok' } with 200 when DB is reachable", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
    expect(body).not.toHaveProperty("db");
  });

  it("returns { status: 'error' } with 503 when DB is unreachable", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "error" });
    expect(body).not.toHaveProperty("db");
  });
});
