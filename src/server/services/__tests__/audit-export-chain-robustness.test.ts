import { describe, it, expect } from "vitest";
import {
  formatAuditJsonChain,
  verifyAuditExportEnvelope,
  type ChainAuditLogItem,
} from "@/server/services/audit-export";
import { computeChainHash, genesisHashFor } from "@/server/services/audit-chain";

function chained(
  orgId: string,
  count: number,
  // Render rows in newest-first order, as the audit router does.
  order: "asc" | "desc" = "desc",
): ChainAuditLogItem[] {
  // Build the chain in chronological order first.
  let prev = genesisHashFor(orgId);
  const built: ChainAuditLogItem[] = [];
  const t0 = new Date("2026-05-16T00:00:00Z").getTime();
  for (let i = 0; i < count; i++) {
    const r = {
      id: `a-${String(i).padStart(4, "0")}`,
      organizationId: orgId,
      userId: null,
      action: `a-${i}`,
      entityType: "X",
      entityId: `x-${i}`,
      diff: null,
      metadata: null,
      ipAddress: null,
      userEmail: null,
      userName: null,
      teamId: null,
      environmentId: null,
      createdAt: new Date(t0 + i * 1000),
    };
    const hash = computeChainHash(prev, r);
    built.push({
      ...r,
      prevHash: prev,
      hash,
      user: null,
    });
    prev = hash;
  }
  return order === "asc" ? built : built.reverse();
}

describe("Codex P1: chain export sorts even when caller passes desc-order rows", () => {
  it("desc-order input → envelope rows are in ascending insertion order", () => {
    const items = chained("org-a", 4, "desc");
    const env = JSON.parse(formatAuditJsonChain(items, "org-a"));
    const ids = env.rows.map((r: { id: string }) => r.id);
    expect(ids).toEqual(["a-0000", "a-0001", "a-0002", "a-0003"]);
  });

  it("envelope from desc input verifies cleanly", () => {
    const items = chained("org-a", 5, "desc");
    const env = JSON.parse(formatAuditJsonChain(items, "org-a"));
    const r = verifyAuditExportEnvelope(env);
    expect(r.valid).toBe(true);
  });

  it("envelope from asc input still verifies (no regression)", () => {
    const items = chained("org-a", 5, "asc");
    const env = JSON.parse(formatAuditJsonChain(items, "org-a"));
    const r = verifyAuditExportEnvelope(env);
    expect(r.valid).toBe(true);
  });
});

describe("Codex P2: malformed timestamps surface as row-level failures, not crashes", () => {
  it("returns a clean failure when a row's createdAt is invalid", () => {
    const items = chained("org-a", 3, "asc");
    const env = JSON.parse(formatAuditJsonChain(items, "org-a"));
    env.rows[1].createdAt = "not-a-real-date";
    const r = verifyAuditExportEnvelope(env);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(1);
    expect(r.reason).toMatch(/createdAt|tampered/i);
  });

  it("does NOT throw on malformed timestamp (deterministic exit, not uncaught)", () => {
    const items = chained("org-a", 2, "asc");
    const env = JSON.parse(formatAuditJsonChain(items, "org-a"));
    env.rows[0].createdAt = "garbage";
    expect(() => verifyAuditExportEnvelope(env)).not.toThrow();
  });
});
