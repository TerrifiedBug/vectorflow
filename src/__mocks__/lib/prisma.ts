import { PrismaClient } from "@/generated/prisma";
import { beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require("@/lib/prisma") as {
  prisma: DeepMockProxy<PrismaClient>;
};

export const prismaMock = prisma;

beforeEach(() => {
  mockReset(prismaMock);
});
