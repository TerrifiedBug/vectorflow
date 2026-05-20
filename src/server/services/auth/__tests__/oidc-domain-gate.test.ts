import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

import {
  assertVerifiedDomainForIssuer,
  extractIssuerHostname,
  hostnameMatchesClaimDomain,
  OPERATOR_BYPASS_CLAIM_ID,
} from "../oidc-domain-gate";

const prisma = mockDeep<PrismaClient>() as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prisma);
});

describe("extractIssuerHostname", () => {
  it("returns the lowercased hostname for a well-formed URL", () => {
    expect(extractIssuerHostname("https://Login.Acme.com/oauth2")).toBe(
      "login.acme.com",
    );
  });

  it("strips a trailing dot", () => {
    expect(extractIssuerHostname("https://login.acme.com./oauth2")).toBe(
      "login.acme.com",
    );
  });

  it("returns null on garbage", () => {
    expect(extractIssuerHostname("not a url")).toBeNull();
    expect(extractIssuerHostname("")).toBeNull();
  });
});

describe("hostnameMatchesClaimDomain", () => {
  it("exact match", () => {
    expect(hostnameMatchesClaimDomain("acme.com", "acme.com")).toBe(true);
  });

  it("subdomain match", () => {
    expect(hostnameMatchesClaimDomain("login.acme.com", "acme.com")).toBe(true);
    expect(
      hostnameMatchesClaimDomain("idp.eu.acme.com", "acme.com"),
    ).toBe(true);
  });

  it("does NOT match adjacent-suffix attempt", () => {
    // `evilacme.com` ends with `acme.com` substring but NOT with
    // `.acme.com` — the gate must refuse this.
    expect(hostnameMatchesClaimDomain("evilacme.com", "acme.com")).toBe(false);
    expect(
      hostnameMatchesClaimDomain("notlogin.evilacme.com", "acme.com"),
    ).toBe(false);
  });

  it("empty inputs are rejected", () => {
    expect(hostnameMatchesClaimDomain("", "acme.com")).toBe(false);
    expect(hostnameMatchesClaimDomain("acme.com", "")).toBe(false);
  });
});

describe("assertVerifiedDomainForIssuer", () => {
  const organizationId = "org_acme";

  it("rejects when the issuer URL is malformed", async () => {
    const result = await assertVerifiedDomainForIssuer({
      prisma,
      organizationId,
      issuerUrl: "this is not a url",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/valid URL/);
    }
    // We never reached the DB.
    expect(prisma.organizationDomainClaim.findMany).not.toHaveBeenCalled();
  });

  it("rejects when the org has no verified domain claims", async () => {
    prisma.organizationDomainClaim.findMany.mockResolvedValue([]);
    const result = await assertVerifiedDomainForIssuer({
      prisma,
      organizationId,
      issuerUrl: "https://login.acme.com/oauth2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/verified domain claim/i);
    }
    expect(prisma.organizationDomainClaim.findMany).toHaveBeenCalledWith({
      where: { organizationId, verifiedAt: { not: null } },
      select: { id: true, domain: true },
    });
  });

  it("accepts when the issuer hostname is a subdomain of a verified claim", async () => {
    prisma.organizationDomainClaim.findMany.mockResolvedValue([
      { id: "claim_1", domain: "acme.com" } as never,
    ]);
    const result = await assertVerifiedDomainForIssuer({
      prisma,
      organizationId,
      issuerUrl: "https://login.acme.com/oauth2",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matchedClaimId).toBe("claim_1");
      expect(result.matchedDomain).toBe("acme.com");
    }
  });

  it("accepts exact-match hostname", async () => {
    prisma.organizationDomainClaim.findMany.mockResolvedValue([
      { id: "claim_apex", domain: "acme.com" } as never,
    ]);
    const result = await assertVerifiedDomainForIssuer({
      prisma,
      organizationId,
      issuerUrl: "https://acme.com/oidc",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects adjacent-suffix attempts (evilacme.com vs acme.com)", async () => {
    prisma.organizationDomainClaim.findMany.mockResolvedValue([
      { id: "claim_apex", domain: "acme.com" } as never,
    ]);
    const result = await assertVerifiedDomainForIssuer({
      prisma,
      organizationId,
      issuerUrl: "https://login.evilacme.com/oauth2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not covered/i);
    }
  });

  it("rejects when the only matching claim belongs to a different org", async () => {
    // The query filters by `organizationId`, so a foreign-org claim
    // simply never appears in the result set. Modelled here by an
    // empty list — equivalent to "no verified claim for this org".
    prisma.organizationDomainClaim.findMany.mockResolvedValue([]);
    const result = await assertVerifiedDomainForIssuer({
      prisma,
      organizationId,
      issuerUrl: "https://login.acme.com/oauth2",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts when one of several verified claims matches", async () => {
    prisma.organizationDomainClaim.findMany.mockResolvedValue([
      { id: "claim_old", domain: "old.example" } as never,
      { id: "claim_new", domain: "acme.com" } as never,
    ]);
    const result = await assertVerifiedDomainForIssuer({
      prisma,
      organizationId,
      issuerUrl: "https://login.acme.com/oauth2",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matchedClaimId).toBe("claim_new");
    }
  });

  it("rejects an issuer hostname that fails normalisation", async () => {
    const result = await assertVerifiedDomainForIssuer({
      prisma,
      organizationId,
      issuerUrl: "https://nope/oauth2", // single-label, no dot
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/normalisation|hostname/i);
    }
  });

  describe("allowSharedHostnames bypass (PR #377)", () => {
    it("verified-claim match wins over the bypass (claim id surfaces, no bypass attribution)", async () => {
      prisma.organizationDomainClaim.findMany.mockResolvedValue([
        { id: "claim_apex", domain: "acme.com" } as never,
      ]);
      const result = await assertVerifiedDomainForIssuer({
        prisma,
        organizationId,
        issuerUrl: "https://login.acme.com/oauth2",
        allowSharedHostnames: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.matchedClaimId).toBe("claim_apex");
      }
    });

    it("accepts a shared-IdP hostname with no verified claim when the flag is on", async () => {
      prisma.organizationDomainClaim.findMany.mockResolvedValue([]);
      const result = await assertVerifiedDomainForIssuer({
        prisma,
        organizationId,
        issuerUrl: "https://accounts.google.com/.well-known/openid-configuration",
        allowSharedHostnames: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.matchedClaimId).toBe(OPERATOR_BYPASS_CLAIM_ID);
        expect(result.matchedDomain).toBe("accounts.google.com");
      }
    });

    it("still rejects a malformed issuer URL even with the flag on", async () => {
      const result = await assertVerifiedDomainForIssuer({
        prisma,
        organizationId,
        issuerUrl: "not a url",
        allowSharedHostnames: true,
      });
      expect(result.ok).toBe(false);
      // Never reached the DB.
      expect(prisma.organizationDomainClaim.findMany).not.toHaveBeenCalled();
    });

    it("still rejects a single-label issuer hostname even with the flag on", async () => {
      const result = await assertVerifiedDomainForIssuer({
        prisma,
        organizationId,
        issuerUrl: "https://nope/oauth2", // single-label fails normalisation
        allowSharedHostnames: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/normalisation|hostname/i);
      }
    });

    it("flag=false (default) behaves identically to omitting the flag — no claim, hard fail", async () => {
      prisma.organizationDomainClaim.findMany.mockResolvedValue([]);
      const result = await assertVerifiedDomainForIssuer({
        prisma,
        organizationId,
        issuerUrl: "https://accounts.google.com/o/oauth2",
        allowSharedHostnames: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/verified domain claim/i);
      }
    });
  });
});
