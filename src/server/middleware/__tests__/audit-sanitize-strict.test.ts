import { describe, it, expect } from "vitest";
import {
  AUDIT_SAFE_KEYS,
  sanitizeInputStrict,
} from "../audit-sanitize";

describe("AUDIT_SAFE_KEYS allowlist", () => {
  it("covers the common identifier and lifecycle fields", () => {
    for (const k of [
      "id",
      "name",
      "description",
      "organizationId",
      "environmentId",
      "teamId",
      "userId",
      "createdAt",
      "updatedAt",
      "status",
      "enabled",
      "type",
      "kind",
      "level",
      "version",
    ]) {
      expect(AUDIT_SAFE_KEYS.has(k)).toBe(true);
    }
  });

  it("excludes high-sensitivity fields", () => {
    for (const k of [
      "password",
      "token",
      "secret",
      "aiApiKey",
      "clientSecret",
      "encryptedValue",
      "totpSecret",
    ]) {
      expect(AUDIT_SAFE_KEYS.has(k)).toBe(false);
    }
  });
});

describe("sanitizeInputStrict (allowlist mode)", () => {
  it("preserves allowlist keys verbatim", () => {
    const out = sanitizeInputStrict({
      id: "x-1",
      name: "Demo",
      status: "active",
    });
    expect(out).toEqual({
      id: "x-1",
      name: "Demo",
      status: "active",
    });
  });

  it("redacts unknown keys to [REDACTED]", () => {
    const out = sanitizeInputStrict({
      id: "x-1",
      unknownField: "secret-value",
    });
    expect(out).toEqual({
      id: "x-1",
      unknownField: "[REDACTED]",
    });
  });

  it("collapses non-allowlist subtrees to [REDACTED] (whole subtree)", () => {
    const out = sanitizeInputStrict({
      id: "x-1",
      meta: { note: "private", type: "info" },
    });
    expect(out).toEqual({
      id: "x-1",
      meta: "[REDACTED]",
    });
  });

  it("recurses into allowlisted subtrees and redacts unknown leaf keys", () => {
    // `name` IS allowlisted, so its nested object is walked. Inside,
    // `id` is allowlisted (kept) and `trusted` is not (redacted).
    const out = sanitizeInputStrict({
      id: "x-1",
      name: { id: "n-1", trusted: "yes" },
    });
    expect(out).toEqual({
      id: "x-1",
      name: { id: "n-1", trusted: "[REDACTED]" },
    });
  });

  it("passes through primitives unchanged", () => {
    expect(sanitizeInputStrict("hello")).toBe("hello");
    expect(sanitizeInputStrict(42)).toBe(42);
    expect(sanitizeInputStrict(null)).toBe(null);
    expect(sanitizeInputStrict(undefined)).toBe(undefined);
  });

  it("serialises Date instances to ISO-8601 (matches the denylist version)", () => {
    const t = new Date("2026-05-16T00:00:00Z");
    const out = sanitizeInputStrict({ createdAt: t });
    expect(out).toEqual({ createdAt: "2026-05-16T00:00:00.000Z" });
  });

  it("keeps allowlist values verbatim regardless of type", () => {
    const out = sanitizeInputStrict({
      enabled: true,
      version: 3,
      kind: "agent",
    });
    expect(out).toEqual({ enabled: true, version: 3, kind: "agent" });
  });
});
