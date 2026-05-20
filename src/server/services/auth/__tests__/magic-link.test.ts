/**
 * Magic-link sign-in service tests.
 *
 * Covers the token lifecycle (mint -> redeem -> single-use rejection),
 * TTL expiry, SSO-precedence on mint, and the GC sweep. The actual email
 * delivery is intentionally out of scope here — the service returns a
 * plaintext token to the caller who is then responsible for embedding it
 * in a URL and shipping it through whatever email transport is configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { createHash } from "node:crypto";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

const mockGetOrgSettings = vi.fn();
vi.mock("@/lib/org-settings", () => ({
  getOrgSettings: (...args: unknown[]) => mockGetOrgSettings(...args),
}));

import { prisma } from "@/lib/prisma";
import {
  MAGIC_LINK_TTL_MS,
  MagicLinkSsoOnlyError,
  consumeMagicLink,
  gcExpiredMagicLinks,
  mintMagicLink,
} from "@/server/services/auth/magic-link";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function hex(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

beforeEach(() => {
  mockReset(prismaMock);
  mockGetOrgSettings.mockReset();
  mockGetOrgSettings.mockResolvedValue({ oidcIssuer: null, oidcClientId: null });
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mintMagicLink", () => {
  it("returns a plaintext token and persists only the hash", async () => {
    prismaMock.magicLinkToken.create.mockResolvedValue({} as never);

    const result = await mintMagicLink({
      organizationId: "org-1",
      email: "alice@example.com",
      requestIp: "203.0.113.5",
    });

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/); // base64url ≥40 chars
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // ± 2s tolerance vs configured TTL.
    const ttl = result.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(MAGIC_LINK_TTL_MS - 2000);
    expect(ttl).toBeLessThanOrEqual(MAGIC_LINK_TTL_MS);

    expect(prismaMock.magicLinkToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        email: "alice@example.com",
        tokenHash: hex(result.token),
        requestIp: "203.0.113.5",
      }),
    });
    // Plaintext token MUST NOT appear in the persisted row.
    const persisted = prismaMock.magicLinkToken.create.mock.calls[0][0].data;
    expect(JSON.stringify(persisted)).not.toContain(result.token);
  });

  it("lowercases + trims the email before persisting", async () => {
    prismaMock.magicLinkToken.create.mockResolvedValue({} as never);

    await mintMagicLink({
      organizationId: "org-1",
      email: "  ALICE@Example.COM  ",
    });

    expect(prismaMock.magicLinkToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "alice@example.com" }),
    });
  });

  it("refuses to mint when the organization is SSO-only", async () => {
    mockGetOrgSettings.mockResolvedValue({
      oidcIssuer: "https://sso.example.com",
      oidcClientId: "client-123",
      oidcClientSecret: "secret-cipher",
    });

    await expect(
      mintMagicLink({ organizationId: "org-sso", email: "alice@example.com" }),
    ).rejects.toBeInstanceOf(MagicLinkSsoOnlyError);
    expect(prismaMock.magicLinkToken.create).not.toHaveBeenCalled();
  });
});

describe("consumeMagicLink", () => {
  it("redeems a fresh token and marks it consumed", async () => {
    const plaintext = "test-token";
    const hash = hex(plaintext);
    prismaMock.magicLinkToken.findUnique.mockResolvedValue({
      id: "mlt-1",
      organizationId: "org-1",
      email: "alice@example.com",
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      consumedAt: null,
    } as never);
    prismaMock.magicLinkToken.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await consumeMagicLink({ token: plaintext });
    expect(result).toEqual({
      ok: true,
      organizationId: "org-1",
      email: "alice@example.com",
    });

    // Update predicate gates on consumedAt: null — race-safe.
    expect(prismaMock.magicLinkToken.updateMany).toHaveBeenCalledWith({
      where: { id: "mlt-1", consumedAt: null },
      data: expect.objectContaining({ consumedAt: expect.any(Date) }),
    });
  });

  it("rejects with not_found for an unknown token", async () => {
    prismaMock.magicLinkToken.findUnique.mockResolvedValue(null);

    const result = await consumeMagicLink({ token: "ghost-token" });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects with expired for a past-TTL token", async () => {
    const plaintext = "test-token";
    prismaMock.magicLinkToken.findUnique.mockResolvedValue({
      id: "mlt-1",
      organizationId: "org-1",
      email: "alice@example.com",
      tokenHash: hex(plaintext),
      expiresAt: new Date(Date.now() - 1_000),
      consumedAt: null,
    } as never);

    const result = await consumeMagicLink({ token: plaintext });
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(prismaMock.magicLinkToken.updateMany).not.toHaveBeenCalled();
  });

  it("rejects replay with already_used (second redeem of same token)", async () => {
    const plaintext = "test-token";
    prismaMock.magicLinkToken.findUnique.mockResolvedValue({
      id: "mlt-1",
      organizationId: "org-1",
      email: "alice@example.com",
      tokenHash: hex(plaintext),
      expiresAt: new Date(Date.now() + 5 * 60_000),
      consumedAt: new Date(),
    } as never);

    const result = await consumeMagicLink({ token: plaintext });
    expect(result).toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects already_used when atomic updateMany affects 0 rows (race lost)", async () => {
    const plaintext = "test-token";
    prismaMock.magicLinkToken.findUnique.mockResolvedValue({
      id: "mlt-1",
      organizationId: "org-1",
      email: "alice@example.com",
      tokenHash: hex(plaintext),
      expiresAt: new Date(Date.now() + 5 * 60_000),
      consumedAt: null,
    } as never);
    prismaMock.magicLinkToken.updateMany.mockResolvedValue({ count: 0 } as never);

    const result = await consumeMagicLink({ token: plaintext });
    expect(result).toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects cross-org redemption with wrong_organization", async () => {
    const plaintext = "test-token";
    prismaMock.magicLinkToken.findUnique.mockResolvedValue({
      id: "mlt-1",
      organizationId: "org-a",
      email: "alice@example.com",
      tokenHash: hex(plaintext),
      expiresAt: new Date(Date.now() + 5 * 60_000),
      consumedAt: null,
    } as never);

    const result = await consumeMagicLink({
      token: plaintext,
      expectedOrganizationId: "org-b",
    });
    expect(result).toEqual({ ok: false, reason: "wrong_organization" });
    expect(prismaMock.magicLinkToken.updateMany).not.toHaveBeenCalled();
  });
});

describe("gcExpiredMagicLinks", () => {
  it("deletes expired-unconsumed tokens and consumed tokens older than 7 days", async () => {
    prismaMock.magicLinkToken.deleteMany.mockResolvedValue({ count: 4 } as never);
    const now = new Date("2026-05-16T12:00:00.000Z");

    await expect(gcExpiredMagicLinks(() => now)).resolves.toBe(4);

    const call = prismaMock.magicLinkToken.deleteMany.mock.calls[0]?.[0];
    expect(call?.where).toEqual({
      OR: [
        { expiresAt: { lt: now }, consumedAt: null },
        {
          consumedAt: {
            lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      ],
    });
  });
});

describe("end-to-end mint -> redeem (positive path)", () => {
  it("a token minted by mintMagicLink is the only one consumeMagicLink accepts", async () => {
    // mintMagicLink writes a row; capture the hash and replay it back.
    prismaMock.magicLinkToken.create.mockResolvedValue({} as never);
    const minted = await mintMagicLink({
      organizationId: "org-1",
      email: "alice@example.com",
    });
    const persistedRow = prismaMock.magicLinkToken.create.mock.calls[0][0]
      .data as {
      tokenHash: string;
      organizationId: string;
      email: string;
      expiresAt: Date;
    };

    // Now wire findUnique to return the row we just persisted.
    prismaMock.magicLinkToken.findUnique.mockImplementation(((args: {
      where: { tokenHash: string };
    }) => {
      if (args.where.tokenHash === persistedRow.tokenHash) {
        return Promise.resolve({
          id: "mlt-1",
          organizationId: persistedRow.organizationId,
          email: persistedRow.email,
          tokenHash: persistedRow.tokenHash,
          expiresAt: persistedRow.expiresAt,
          consumedAt: null,
        } as never);
      }
      return Promise.resolve(null);
    }) as never);
    prismaMock.magicLinkToken.updateMany.mockResolvedValue({ count: 1 } as never);

    // Redeem with the plaintext we got back from mint — works.
    const ok = await consumeMagicLink({ token: minted.token });
    expect(ok).toEqual({
      ok: true,
      organizationId: "org-1",
      email: "alice@example.com",
    });

    // Try a different plaintext — fails.
    const bad = await consumeMagicLink({ token: "different-token" });
    expect(bad).toEqual({ ok: false, reason: "not_found" });
  });
});
