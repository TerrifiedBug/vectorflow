import { describe, it, expect } from "vitest";
import { verifyAuditExportEnvelope } from "@/server/services/audit-export";

const baseEnvelope = (orgId: string, rows: unknown[]) => ({
  verifierVersion: 1,
  organizationId: orgId,
  exportedAt: "2026-05-16T00:00:00Z",
  rows,
});

describe("verifyAuditExportEnvelope — malformed row safety (Codex P2)", () => {
  it("rejects rows: [null] cleanly without throwing", () => {
    const env = baseEnvelope("org-a", [null]);
    expect(() => verifyAuditExportEnvelope(env)).not.toThrow();
    const r = verifyAuditExportEnvelope(env);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(0);
    expect(r.reason).toMatch(/plain object/i);
  });

  it("rejects rows: [primitives] cleanly", () => {
    const env = baseEnvelope("org-a", ["string-not-object" as unknown]);
    const r = verifyAuditExportEnvelope(env);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(0);
  });

  it("rejects rows: [array-not-object] cleanly", () => {
    const env = baseEnvelope("org-a", [[1, 2, 3] as unknown]);
    const r = verifyAuditExportEnvelope(env);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(0);
  });

  it("rejects rows missing prevHash/hash cleanly", () => {
    const env = baseEnvelope("org-a", [
      {
        id: "a-1",
        organizationId: "org-a",
        userId: null,
        action: "x",
        entityType: "X",
        entityId: "x-1",
        diff: null,
        metadata: null,
        ipAddress: null,
        userEmail: null,
        userName: null,
        teamId: null,
        environmentId: null,
        createdAt: "2026-05-16T00:00:00Z",
        // prevHash + hash deliberately absent
      },
    ]);
    expect(() => verifyAuditExportEnvelope(env)).not.toThrow();
    const r = verifyAuditExportEnvelope(env);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(0);
    expect(r.reason).toMatch(/prevHash|hash/i);
  });
});
