/**
 * Prisma mock helper for Vitest.
 *
 * Usage in test files:
 * ```ts
 * import { vi } from "vitest";
 * import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
 * import type { PrismaClient } from "@/generated/prisma";
 *
 * vi.mock("@/lib/prisma", () => ({
 *   prisma: mockDeep<PrismaClient>(),
 * }));
 *
 * import { prisma } from "@/lib/prisma";
 * const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
 *
 * beforeEach(() => {
 *   mockReset(prismaMock);
 * });
 * ```
 *
 * The vi.mock factory is hoisted above imports, so mockDeep creates a fresh
 * mock that replaces the real PrismaClient. Importing `prisma` from the
 * mocked module gives you the mock instance. Cast it to DeepMockProxy for
 * full type-safe mock API access.
 */
export {};
