import { describe, it, expect } from "vitest";
import {
  canonicalizeAuditRow,
  computeChainHash,
  type ChainableAuditRow,
} from "../audit-chain";

const baseRow = (overrides: Partial<ChainableAuditRow> = {}): ChainableAuditRow => ({
  id: "audit-1",
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
  ...overrides,
});

describe("canonicalizeAuditRow — deep canonicalization (Codex P1)", () => {
  it("nested object keys are sorted at every level", () => {
    const a = canonicalizeAuditRow(
      baseRow({
        diff: { name: { old: "a", new: "b" }, value: { new: 2, old: 1 } },
      }),
    );
    const b = canonicalizeAuditRow(
      baseRow({
        // Same data, every key in reverse insertion order
        diff: { value: { old: 1, new: 2 }, name: { new: "b", old: "a" } },
      }),
    );
    expect(a).toBe(b);
  });

  it("nested arrays preserve order (arrays are positional, not associative)", () => {
    const a = canonicalizeAuditRow(
      baseRow({ metadata: { changes: [1, 2, 3] } }),
    );
    const b = canonicalizeAuditRow(
      baseRow({ metadata: { changes: [3, 2, 1] } }),
    );
    expect(a).not.toBe(b);
  });

  it("hash is stable across reorderings of nested object keys", () => {
    const r1 = baseRow({
      diff: {
        a: { foo: { x: 1, y: 2 }, bar: 3 },
        b: { nested: { p: "q", r: "s" } },
      },
    });
    const r2 = baseRow({
      diff: {
        b: { nested: { r: "s", p: "q" } },
        a: { bar: 3, foo: { y: 2, x: 1 } },
      },
    });
    expect(computeChainHash("a".repeat(64), r1)).toBe(
      computeChainHash("a".repeat(64), r2),
    );
  });

  it("treats null and missing keys identically in nested objects", () => {
    const a = canonicalizeAuditRow(
      baseRow({ metadata: { v: 1, extra: null } as unknown as Record<string, unknown> }),
    );
    const b = canonicalizeAuditRow(
      baseRow({ metadata: { extra: null, v: 1 } as unknown as Record<string, unknown> }),
    );
    expect(a).toBe(b);
  });

  it("nested Date values serialize to ISO strings (Postgres JSONB round-trip equivalence)", () => {
    const t = new Date("2026-05-16T10:00:00Z");
    const a = canonicalizeAuditRow(
      baseRow({ metadata: { at: t } as unknown as Record<string, unknown> }),
    );
    const b = canonicalizeAuditRow(
      baseRow({
        metadata: { at: t.toISOString() } as unknown as Record<string, unknown>,
      }),
    );
    expect(a).toBe(b);
  });
});
