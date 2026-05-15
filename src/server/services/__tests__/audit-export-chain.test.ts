import { describe, it, expect } from "vitest";
import {
  formatAuditJsonChain,
  verifyAuditExportEnvelope,
  type ChainAuditLogItem,
} from "@/server/services/audit-export";
import {
  computeChainHash,
  genesisHashFor,
  type ChainableAuditRow,
} from "@/server/services/audit-chain";

function chainable(o: Partial<ChainableAuditRow> = {}): ChainableAuditRow {
  return {
    id: "a-1",
    organizationId: "org-a",
    userId: null,
    action: "secret.create",
    entityType: "Secret",
    entityId: "secret-1",
    diff: null,
    metadata: null,
    ipAddress: null,
    userEmail: null,
    userName: null,
    teamId: null,
    environmentId: null,
    createdAt: new Date("2026-05-16T00:00:00Z"),
    ...o,
  };
}

function buildExport(orgId: string, count: number): ChainAuditLogItem[] {
  let prev = genesisHashFor(orgId);
  const items: ChainAuditLogItem[] = [];
  for (let i = 0; i < count; i++) {
    const r = chainable({ id: `a-${i}`, action: `action-${i}` });
    const hash = computeChainHash(prev, r);
    items.push({
      id: r.id,
      organizationId: r.organizationId,
      userId: r.userId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      diff: r.diff,
      metadata: r.metadata,
      ipAddress: r.ipAddress,
      userEmail: r.userEmail,
      userName: r.userName,
      teamId: r.teamId,
      environmentId: r.environmentId,
      createdAt: r.createdAt,
      prevHash: prev,
      hash,
      user: null,
    });
    prev = hash;
  }
  return items;
}

describe("formatAuditJsonChain", () => {
  it("emits an envelope with orgId, rows, verifierVersion, and exportedAt", () => {
    const items = buildExport("org-a", 2);
    const json = formatAuditJsonChain(items, "org-a");
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed.organizationId).toBe("org-a");
    expect(parsed.verifierVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe("string");
    expect(Array.isArray(parsed.rows)).toBe(true);
  });

  it("preserves prevHash and hash on every row", () => {
    const items = buildExport("org-a", 3);
    const json = formatAuditJsonChain(items, "org-a");
    const parsed = JSON.parse(json) as { rows: Array<{ prevHash: string; hash: string }> };

    expect(parsed.rows).toHaveLength(3);
    for (const r of parsed.rows) {
      expect(typeof r.prevHash).toBe("string");
      expect(r.prevHash).toHaveLength(64);
      expect(typeof r.hash).toBe("string");
      expect(r.hash).toHaveLength(64);
    }
  });

  it("excludes rows without chain (hash == null) by default", () => {
    const chained = buildExport("org-a", 2);
    const unchained: ChainAuditLogItem = {
      ...chained[0],
      id: "legacy",
      prevHash: null,
      hash: null,
    };
    const json = formatAuditJsonChain([unchained, ...chained], "org-a");
    const parsed = JSON.parse(json) as { rows: Array<{ id: string }> };
    expect(parsed.rows.map((r) => r.id)).not.toContain("legacy");
  });
});

describe("verifyAuditExportEnvelope", () => {
  it("accepts a genuine envelope", () => {
    const items = buildExport("org-a", 4);
    const envelope = JSON.parse(formatAuditJsonChain(items, "org-a"));
    const r = verifyAuditExportEnvelope(envelope);
    expect(r.valid).toBe(true);
  });

  it("rejects a tampered middle row and points at it", () => {
    const items = buildExport("org-a", 4);
    const envelope = JSON.parse(formatAuditJsonChain(items, "org-a"));
    envelope.rows[2].action = "action-TAMPERED";
    const r = verifyAuditExportEnvelope(envelope);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(2);
  });

  it("rejects a deleted row (chain link broken at the gap)", () => {
    const items = buildExport("org-a", 4);
    const envelope = JSON.parse(formatAuditJsonChain(items, "org-a"));
    envelope.rows.splice(1, 1);
    const r = verifyAuditExportEnvelope(envelope);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(1);
  });

  it("rejects when the envelope's organizationId doesn't match the rows", () => {
    const items = buildExport("org-a", 2);
    const envelope = JSON.parse(formatAuditJsonChain(items, "org-a"));
    envelope.organizationId = "org-b";
    const r = verifyAuditExportEnvelope(envelope);
    expect(r.valid).toBe(false);
  });

  it("rejects on missing or wrong verifierVersion", () => {
    const items = buildExport("org-a", 1);
    const envelope = JSON.parse(formatAuditJsonChain(items, "org-a"));
    envelope.verifierVersion = 99;
    const r = verifyAuditExportEnvelope(envelope);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/version/i);
  });
});
