import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import { GET } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns 200 when database is reachable", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }] as never);

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
  });

  it("returns 503 when database is unreachable", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("Connection refused"));

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.checks.database).toBe("error");
  });
});
