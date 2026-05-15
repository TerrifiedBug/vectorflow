import { describe, it, expect } from "vitest";
import {
  canonicalizeAuditRow,
  computeChainHash,
  genesisHashFor,
  verifyChain,
  type ChainableAuditRow,
} from "../audit-chain";

const row = (overrides: Partial<ChainableAuditRow> = {}): ChainableAuditRow => ({
  id: "audit-1",
  organizationId: "org-a",
  userId: null,
  action: "secret.create",
  entityType: "Secret",
  entityId: "secret-1",
  diff: null,
  metadata: null,
  ipAddress: "10.0.0.1",
  userEmail: null,
  userName: null,
  teamId: null,
  environmentId: "env-1",
  createdAt: new Date("2026-05-16T00:00:00Z"),
  ...overrides,
});

describe("canonicalizeAuditRow", () => {
  it("is stable across key order", () => {
    const r1 = row({ userId: "u1" });
    // Construct an object with shuffled keys but the same fields
    const shuffled: ChainableAuditRow = {
      createdAt: r1.createdAt,
      entityId: r1.entityId,
      entityType: r1.entityType,
      ipAddress: r1.ipAddress,
      userEmail: r1.userEmail,
      organizationId: r1.organizationId,
      diff: r1.diff,
      metadata: r1.metadata,
      action: r1.action,
      teamId: r1.teamId,
      userId: r1.userId,
      userName: r1.userName,
      environmentId: r1.environmentId,
      id: r1.id,
    };
    expect(canonicalizeAuditRow(r1)).toBe(canonicalizeAuditRow(shuffled));
  });

  it("includes all required identity fields", () => {
    const out = canonicalizeAuditRow(row({ userId: "u1" }));
    expect(out).toContain('"organizationId":"org-a"');
    expect(out).toContain('"action":"secret.create"');
    expect(out).toContain('"entityId":"secret-1"');
  });

  it("differs when any meaningful field changes", () => {
    const a = canonicalizeAuditRow(row());
    const b = canonicalizeAuditRow(row({ action: "secret.delete" }));
    expect(a).not.toBe(b);
  });
});

describe("genesisHashFor", () => {
  it("is deterministic per org", () => {
    const a = genesisHashFor("org-a");
    const b = genesisHashFor("org-a");
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // sha256 hex
  });
  it("differs across orgs", () => {
    expect(genesisHashFor("org-a")).not.toBe(genesisHashFor("org-b"));
  });
});

describe("computeChainHash", () => {
  it("changes when prevHash changes", () => {
    const r = row();
    const h1 = computeChainHash("a".repeat(64), r);
    const h2 = computeChainHash("b".repeat(64), r);
    expect(h1).not.toBe(h2);
  });
  it("changes when row content changes", () => {
    const prev = "a".repeat(64);
    const h1 = computeChainHash(prev, row());
    const h2 = computeChainHash(prev, row({ action: "secret.delete" }));
    expect(h1).not.toBe(h2);
  });
});

describe("verifyChain", () => {
  function buildChain(orgId: string, rows: ChainableAuditRow[]) {
    let prev = genesisHashFor(orgId);
    return rows.map((r, idx) => {
      const hash = computeChainHash(prev, r);
      const entry = { ...r, prevHash: prev, hash, _idx: idx };
      prev = hash;
      return entry;
    });
  }

  it("accepts a genuine chain", () => {
    const rows = [
      row({ id: "a-1" }),
      row({ id: "a-2", action: "pipeline.deploy" }),
      row({ id: "a-3", action: "secret.read" }),
    ];
    const chain = buildChain("org-a", rows);
    const result = verifyChain(chain, "org-a");
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it("rejects a tampered middle row, pointing to its position", () => {
    const rows = [
      row({ id: "b-1" }),
      row({ id: "b-2", action: "pipeline.deploy" }),
      row({ id: "b-3", action: "secret.read" }),
    ];
    const chain = buildChain("org-a", rows);
    // Tamper: rewrite the middle row's action without recomputing hashes
    const tampered = chain.map((c, i) =>
      i === 1 ? { ...c, action: "pipeline.delete" } : c,
    );
    const result = verifyChain(tampered, "org-a");
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("rejects a deleted row (chain breaks)", () => {
    const rows = [
      row({ id: "c-1" }),
      row({ id: "c-2", action: "pipeline.deploy" }),
      row({ id: "c-3", action: "secret.read" }),
    ];
    const chain = buildChain("org-a", rows);
    // Drop the middle row
    const tampered = [chain[0], chain[2]];
    const result = verifyChain(tampered, "org-a");
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("rejects when first row's prevHash isn't the org genesis", () => {
    const rows = [row({ id: "d-1" })];
    const chain = buildChain("org-a", rows);
    // Tamper: replace prevHash on the first row
    const tampered = [
      { ...chain[0], prevHash: "f".repeat(64) },
    ];
    const result = verifyChain(tampered, "org-a");
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it("rejects when claiming the wrong org", () => {
    const rows = [row({ id: "e-1", organizationId: "org-a" })];
    const chain = buildChain("org-a", rows);
    const result = verifyChain(chain, "org-b");
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it("accepts an empty chain (no rows recorded yet)", () => {
    expect(verifyChain([], "org-a")).toEqual({ valid: true });
  });
});
