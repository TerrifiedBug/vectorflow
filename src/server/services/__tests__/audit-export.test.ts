import { describe, it, expect } from "vitest";
import {
  formatAuditCsv,
  formatAuditJson,
  type AuditLogItem,
} from "@/server/services/audit-export";

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makeItem(overrides: Partial<AuditLogItem> = {}): AuditLogItem {
  return {
    id: overrides.id ?? "audit-1",
    createdAt: overrides.createdAt ?? new Date("2025-06-01T12:00:00Z"),
    action: overrides.action ?? "deploy.agent",
    entityType: overrides.entityType ?? "Pipeline",
    entityId: overrides.entityId ?? "pipeline-1",
    teamId: overrides.teamId ?? "team-1",
    environmentId: overrides.environmentId ?? "env-1",
    ipAddress: overrides.ipAddress ?? "192.168.1.1",
    metadata: "metadata" in overrides ? overrides.metadata : { input: { foo: "bar" } },
    user: "user" in overrides ? (overrides.user as AuditLogItem["user"]) : { id: "user-1", name: "Test User", email: "test@example.com" },
  };
}

// ─── CSV formatting ─────────────────────────────────────────────────────────

describe("formatAuditCsv", () => {
  it("produces correct header row", () => {
    const csv = formatAuditCsv([]);
    const header = csv.split("\n")[0];
    expect(header).toBe(
      "Timestamp,User,Email,Action,Entity Type,Entity ID,Team ID,Environment ID,IP Address,Details",
    );
  });

  it("formats a single item", () => {
    const csv = formatAuditCsv([makeItem()]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toContain("2025-06-01T12:00:00.000Z");
    expect(lines[1]).toContain("Test User");
    expect(lines[1]).toContain("test@example.com");
    expect(lines[1]).toContain("deploy.agent");
  });

  it("escapes commas in values", () => {
    const item = makeItem({
      user: { id: "u1", name: "Last, First", email: "a@b.com" },
    });
    const csv = formatAuditCsv([item]);
    // Name with comma should be wrapped in double quotes
    expect(csv).toContain('"Last, First"');
  });

  it("escapes double quotes in values", () => {
    const item = makeItem({
      user: { id: "u1", name: 'Say "hello"', email: "a@b.com" },
    });
    const csv = formatAuditCsv([item]);
    expect(csv).toContain('"Say ""hello"""');
  });

  it("protects against formula injection for = prefix", () => {
    const item = makeItem({ action: "=SUM(A1:A10)" });
    const csv = formatAuditCsv([item]);
    expect(csv).toContain("'=SUM(A1:A10)");
  });

  it("protects against formula injection for + prefix", () => {
    const item = makeItem({ action: "+cmd" });
    const csv = formatAuditCsv([item]);
    expect(csv).toContain("'+cmd");
  });

  it("protects against formula injection for - prefix", () => {
    const item = makeItem({ action: "-cmd" });
    const csv = formatAuditCsv([item]);
    expect(csv).toContain("'-cmd");
  });

  it("protects against formula injection for @ prefix", () => {
    const item = makeItem({ action: "@SUM" });
    const csv = formatAuditCsv([item]);
    expect(csv).toContain("'@SUM");
  });

  it("handles null user gracefully", () => {
    const item = makeItem({ user: null });
    const csv = formatAuditCsv([item]);
    const lines = csv.split("\n");
    // User and email columns should be empty
    const cols = lines[1].split(",");
    expect(cols[1]).toBe(""); // user name
    expect(cols[2]).toBe(""); // email
  });

  it("handles null metadata gracefully", () => {
    const item = makeItem({ metadata: null });
    const csv = formatAuditCsv([item]);
    const lines = csv.split("\n");
    // With null metadata, the row should end with an empty Details column
    expect(lines[1]).toMatch(/,$/);
  });

  it("returns only header for empty array", () => {
    const csv = formatAuditCsv([]);
    expect(csv.split("\n")).toHaveLength(1);
  });
});

// ─── JSON formatting ────────────────────────────────────────────────────────

describe("formatAuditJson", () => {
  it("returns a valid JSON array", () => {
    const json = formatAuditJson([makeItem()]);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it("includes expected fields in each entry", () => {
    const json = formatAuditJson([makeItem()]);
    const parsed = JSON.parse(json);
    const entry = parsed[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("timestamp");
    expect(entry).toHaveProperty("user");
    expect(entry).toHaveProperty("email");
    expect(entry).toHaveProperty("action");
    expect(entry).toHaveProperty("entityType");
    expect(entry).toHaveProperty("entityId");
    expect(entry).toHaveProperty("teamId");
    expect(entry).toHaveProperty("environmentId");
    expect(entry).toHaveProperty("ipAddress");
    expect(entry).toHaveProperty("metadata");
  });

  it("nests metadata as an object", () => {
    const item = makeItem({ metadata: { input: { key: "value" } } });
    const json = formatAuditJson([item]);
    const parsed = JSON.parse(json);
    expect(parsed[0].metadata).toEqual({ input: { key: "value" } });
  });

  it("handles null user", () => {
    const json = formatAuditJson([makeItem({ user: null })]);
    const parsed = JSON.parse(json);
    expect(parsed[0].user).toBeNull();
    expect(parsed[0].email).toBeNull();
  });

  it("returns empty array for empty input", () => {
    const json = formatAuditJson([]);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([]);
  });
});
