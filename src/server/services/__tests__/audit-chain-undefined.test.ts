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

describe("canonicalizeAuditRow — undefined matches JSON.stringify semantics", () => {
  // Persisted JSONB drops object properties whose value is `undefined`
  // (JSON.stringify's documented behaviour). For the chain hash to round-
  // trip through Postgres, canonicalize MUST omit undefined fields,
  // NOT convert them to null.

  it("omits undefined object properties (matching JSON.stringify)", () => {
    // Row as supplied at insert (with undefined sub-property)
    const atInsert = baseRow({
      diff: { name: { old: "a", new: undefined } } as unknown as Record<string, unknown>,
    });
    // Row as read back after Postgres JSONB round-trip (undefined dropped)
    const afterRoundTrip = baseRow({
      diff: { name: { old: "a" } } as unknown as Record<string, unknown>,
    });
    expect(canonicalizeAuditRow(atInsert)).toBe(
      canonicalizeAuditRow(afterRoundTrip),
    );
  });

  it("computes the same chain hash for insert-time and round-tripped rows", () => {
    const prev = "a".repeat(64);
    const atInsert = baseRow({
      diff: {
        before: { name: "a", deleted_field: undefined },
        after: { name: "b" },
      } as unknown as Record<string, unknown>,
    });
    const afterRoundTrip = baseRow({
      diff: {
        before: { name: "a" },
        after: { name: "b" },
      } as unknown as Record<string, unknown>,
    });
    expect(computeChainHash(prev, atInsert)).toBe(
      computeChainHash(prev, afterRoundTrip),
    );
  });

  it("preserves explicit null fields (null is a real JSON value)", () => {
    const withNull = baseRow({
      metadata: { v: null } as unknown as Record<string, unknown>,
    });
    const withoutKey = baseRow({
      metadata: {} as unknown as Record<string, unknown>,
    });
    // null is persisted, the key remains; hashes MUST differ.
    expect(canonicalizeAuditRow(withNull)).not.toBe(
      canonicalizeAuditRow(withoutKey),
    );
  });

  it("array entries that are undefined are emitted as null (matches JSON.stringify)", () => {
    // JSON.stringify([1, undefined, 3]) === '[1,null,3]' — arrays use null sentinel.
    const r = baseRow({
      metadata: { vs: [1, undefined, 3] } as unknown as Record<string, unknown>,
    });
    const c = canonicalizeAuditRow(r);
    expect(c).toContain("[1,null,3]");
  });
});
