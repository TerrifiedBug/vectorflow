/**
 * Agent tenant isolation tests.
 *
 * Verification criteria from the threat model:
 * - Token from org A rejected by org B's hostname (slug mismatch → 401)
 * - Legacy token rejected on non-default subdomain
 * - Token with no embedded slug accepted on the default org (OSS path)
 * - Org-scoped auth never finds nodes belonging to a different org
 * - Suspended org returns 503 + Retry-After
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => {
  const client = mockDeep<PrismaClient>();
  // `authenticateAgentInOrg` resolves the node credential via `adminPrisma`
  // (a pre-context lookup that must bypass RLS); share one deep mock so the
  // existing `prismaMock.vectorNode.*` assertions observe those calls.
  return { prisma: client, adminPrisma: client };
});

vi.mock("@/lib/logger", () => ({
  warnLog: vi.fn(),
  errorLog: vi.fn(),
  debugLog: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

import {
  generateNodeToken,
  generateEnrollmentToken,
  parseTokenSlug,
  getNodeTokenIdentifier,
  isLegacyNodeToken,
  isLegacyEnrollmentToken,
  parseEnrollmentTokenSlug,
  parseNodeTokenSlug,
} from "@/server/services/agent-token";
import { resolveAgentOrg } from "@/server/services/agent-org-binding";
import { authenticateAgentInOrg } from "@/server/services/agent-auth";

beforeEach(() => {
  mockReset(prismaMock);
});

// ─── Token grammar ────────────────────────────────────────────────────────────

describe("token grammar", () => {
  it("enrollment token embeds org slug", async () => {
    const { token } = await generateEnrollmentToken("acme");
    expect(token).toMatch(/^vf_enroll_acme_[a-f0-9]{16}_[a-f0-9]{64}$/);
    expect(parseEnrollmentTokenSlug(token)).toBe("acme");
    expect(isLegacyEnrollmentToken(token)).toBe(false);
  });

  it("legacy enrollment token (no slug) is detected", async () => {
    // Legacy format: vf_enroll_<64hex>
    const legacyToken = `vf_enroll_${"a".repeat(64)}`;
    expect(isLegacyEnrollmentToken(legacyToken)).toBe(true);
    expect(parseEnrollmentTokenSlug(legacyToken)).toBeNull();
  });

  it("node token embeds org slug and stable identifier", async () => {
    const { token, identifier } = await generateNodeToken("acme");
    expect(token).toMatch(/^vf_node_acme_[a-f0-9]{16}_[a-f0-9]{64}$/);
    expect(parseNodeTokenSlug(token)).toBe("acme");
    expect(getNodeTokenIdentifier(token)).toBe(identifier);
    expect(isLegacyNodeToken(token)).toBe(false);
  });

  it("legacy node token (no slug) returns identifier correctly", () => {
    const id = "a".repeat(16);
    const secret = "b".repeat(64);
    const legacyToken = `vf_node_${id}_${secret}`;
    expect(isLegacyNodeToken(legacyToken)).toBe(true);
    expect(parseNodeTokenSlug(legacyToken)).toBeNull();
    expect(getNodeTokenIdentifier(legacyToken)).toBe(id);
  });

  it("parseTokenSlug returns slug from enrollment token", async () => {
    const { token } = await generateEnrollmentToken("beta-org");
    expect(parseTokenSlug(token)).toBe("beta-org");
  });

  it("parseTokenSlug returns slug from node token", async () => {
    const { token } = await generateNodeToken("beta-org");
    expect(parseTokenSlug(token)).toBe("beta-org");
  });

  it("parseTokenSlug returns null for legacy tokens", () => {
    const legacy = `vf_node_${"a".repeat(16)}_${"b".repeat(64)}`;
    expect(parseTokenSlug(legacy)).toBeNull();
  });

  it("default org slug produces default-scoped tokens", async () => {
    const { token: et } = await generateEnrollmentToken();
    const { token: nt } = await generateNodeToken();
    expect(parseEnrollmentTokenSlug(et)).toBe("default");
    expect(parseNodeTokenSlug(nt)).toBe("default");
  });
});

// ─── resolveAgentOrg ─────────────────────────────────────────────────────────

describe("resolveAgentOrg — subdomain-bound path (X-VF-Org-Slug header present)", () => {
  it("returns orgContext when header slug matches token slug", async () => {
    const { token } = await generateNodeToken("acme");

    prismaMock.organization.findUnique.mockResolvedValue({
      id: "org-acme",
      slug: "acme",
      suspendedAt: null,
      deletedAt: null,
    } as never);

    const req = new Request("http://acme.agents.vectorflow.sh/api/agent/heartbeat", {
      headers: {
        "x-vf-org-slug": "acme",
        authorization: `Bearer ${token}`,
      },
    });

    const result = await resolveAgentOrg(req);
    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as Awaited<ReturnType<typeof resolveAgentOrg>>;
    if (ctx instanceof Response) throw new Error("unexpected");
    expect(ctx.orgId).toBe("org-acme");
    expect(ctx.orgSlug).toBe("acme");
    expect(ctx.isLegacyToken).toBe(false);
  });

  it("returns 401 when token slug does not match header slug (cross-tenant attempt)", async () => {
    const { token } = await generateNodeToken("acme"); // token for acme

    const req = new Request("http://beta.agents.vectorflow.sh/api/agent/heartbeat", {
      headers: {
        "x-vf-org-slug": "beta",          // arriving on beta's subdomain
        authorization: `Bearer ${token}`, // but carrying acme's token
      },
    });

    const result = await resolveAgentOrg(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    // No DB lookup should happen — rejection is pre-DB
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it("returns 401 for legacy token on non-default subdomain", async () => {
    const legacyToken = `vf_node_${"a".repeat(16)}_${"b".repeat(64)}`;

    const req = new Request("http://acme.agents.vectorflow.sh/api/agent/heartbeat", {
      headers: {
        "x-vf-org-slug": "acme",
        authorization: `Bearer ${legacyToken}`,
      },
    });

    const result = await resolveAgentOrg(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("accepts legacy token on default subdomain (OSS compat)", async () => {
    const legacyToken = `vf_node_${"a".repeat(16)}_${"b".repeat(64)}`;

    const req = new Request("http://default.agents.vectorflow.sh/api/agent/heartbeat", {
      headers: {
        "x-vf-org-slug": "default",
        authorization: `Bearer ${legacyToken}`,
      },
    });

    const result = await resolveAgentOrg(req);
    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as Exclude<typeof result, Response>;
    expect(ctx.orgId).toBe("default");
    expect(ctx.isLegacyToken).toBe(true);
  });

  it("returns 503 + Retry-After when org is suspended", async () => {
    const { token } = await generateNodeToken("acme");

    prismaMock.organization.findUnique.mockResolvedValue({
      id: "org-acme",
      slug: "acme",
      suspendedAt: new Date(),
      deletedAt: null,
    } as never);

    const req = new Request("http://acme.agents.vectorflow.sh/api/agent/heartbeat", {
      headers: {
        "x-vf-org-slug": "acme",
        authorization: `Bearer ${token}`,
      },
    });

    const result = await resolveAgentOrg(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
    expect((result as Response).headers.get("Retry-After")).toBe("86400");
  });

  it("returns 401 when org slug not found in DB", async () => {
    const { token } = await generateNodeToken("ghost");
    prismaMock.organization.findUnique.mockResolvedValue(null);

    const req = new Request("http://ghost.agents.vectorflow.sh/api/agent/heartbeat", {
      headers: {
        "x-vf-org-slug": "ghost",
        authorization: `Bearer ${token}`,
      },
    });

    const result = await resolveAgentOrg(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

describe("resolveAgentOrg — OSS path (no X-VF-Org-Slug header)", () => {
  it("falls back to default org for slug-prefixed default token", async () => {
    const { token } = await generateNodeToken("default");

    const req = new Request("http://localhost/api/agent/heartbeat", {
      headers: { authorization: `Bearer ${token}` },
    });

    const result = await resolveAgentOrg(req);
    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as Exclude<typeof result, Response>;
    expect(ctx.orgId).toBe("default");
    expect(ctx.orgSlug).toBe("default");
    // No DB lookup needed for the default org
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to default org for legacy token (no slug)", async () => {
    const legacy = `vf_node_${"a".repeat(16)}_${"b".repeat(64)}`;
    const req = new Request("http://localhost/api/agent/heartbeat", {
      headers: { authorization: `Bearer ${legacy}` },
    });

    const result = await resolveAgentOrg(req);
    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as Exclude<typeof result, Response>;
    expect(ctx.orgId).toBe("default");
    expect(ctx.isLegacyToken).toBe(true);
  });

  it("resolves real org from token slug without header", async () => {
    const { token } = await generateNodeToken("acme");

    prismaMock.organization.findUnique.mockResolvedValue({
      id: "org-acme",
      slug: "acme",
      suspendedAt: null,
      deletedAt: null,
    } as never);

    const req = new Request("http://acme.vectorflow.sh/api/agent/heartbeat", {
      headers: { authorization: `Bearer ${token}` },
    });

    const result = await resolveAgentOrg(req);
    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as Exclude<typeof result, Response>;
    expect(ctx.orgId).toBe("org-acme");
  });
});

// ─── authenticateAgentInOrg ───────────────────────────────────────────────────

describe("authenticateAgentInOrg — org boundary enforcement", () => {
  it("finds node when token matches within same org", async () => {
    const { token, identifier } = await generateNodeToken("acme");

    prismaMock.vectorNode.findFirst.mockResolvedValue({
      id: "node-1",
      environmentId: "env-1",
      nodeTokenHash: await (await import("bcryptjs")).hash(token, 10),
    } as never);

    const req = new Request("http://localhost/api/agent/heartbeat", {
      headers: { authorization: `Bearer ${token}` },
    });

    const result = await authenticateAgentInOrg(req, "org-acme");
    expect(result).not.toBeNull();
    expect(result?.nodeId).toBe("node-1");

    // Verify the DB query included the org scope
    expect(prismaMock.vectorNode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-acme" }),
      }),
    );
    // Satisfy unused variable check
    void identifier;
  });

  it("returns null when node belongs to different org (token replay across orgs)", async () => {
    const { token } = await generateNodeToken("acme");
    // DB returns null because the WHERE clause includes organizationId: "org-beta"
    // and the node belongs to org-acme
    prismaMock.vectorNode.findFirst.mockResolvedValue(null);

    const req = new Request("http://localhost/api/agent/heartbeat", {
      headers: { authorization: `Bearer ${token}` },
    });

    const result = await authenticateAgentInOrg(req, "org-beta");
    expect(result).toBeNull();
    expect(prismaMock.vectorNode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-beta" }),
      }),
    );
  });

  it("returns null when no authorization header", async () => {
    const req = new Request("http://localhost/api/agent/heartbeat");
    const result = await authenticateAgentInOrg(req, "org-acme");
    expect(result).toBeNull();
    expect(prismaMock.vectorNode.findFirst).not.toHaveBeenCalled();
  });

  it("legacy token scans only this org's un-migrated nodes", async () => {
    const legacy = "vf_node_old_format_no_identifier";
    // No match in org-beta's nodes
    prismaMock.vectorNode.findMany.mockResolvedValue([]);

    const req = new Request("http://localhost/api/agent/heartbeat", {
      headers: { authorization: `Bearer ${legacy}` },
    });

    const result = await authenticateAgentInOrg(req, "org-beta");
    expect(result).toBeNull();
    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-beta",
          nodeTokenId: null,
        }),
      }),
    );
  });
});
