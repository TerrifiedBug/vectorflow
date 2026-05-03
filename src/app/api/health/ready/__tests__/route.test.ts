import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/lib/redis", () => ({
  isRedisAvailable: vi.fn(() => false),
}));

import { prisma } from "@/lib/prisma";
import { isRedisAvailable } from "@/lib/redis";
import { GET } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const isRedisAvailableMock = vi.mocked(isRedisAvailable);

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    isRedisAvailableMock.mockReturnValue(false);
    delete process.env.VF_REDIS_REQUIRED;
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

  it("returns 503 when Redis is required but unavailable", async () => {
    process.env.VF_REDIS_REQUIRED = "true";
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }] as never);
    isRedisAvailableMock.mockReturnValue(false);

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.checks.database).toBe("ok");
    expect(body.checks.redis).toBe("error");
  });

  it("returns 200 when required Redis and database are reachable", async () => {
    process.env.VF_REDIS_REQUIRED = "true";
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }] as never);
    isRedisAvailableMock.mockReturnValue(true);

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(body.checks.redis).toBe("ok");
  });
});
