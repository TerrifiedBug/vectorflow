import { describe, it, expect } from "vitest";
import type { VrlSuggestion } from "../vrl-suggestion-types";
import {
  parseVrlChatResponse,
  computeVrlSuggestionStatuses,
  applyVrlSuggestion,
} from "../vrl-suggestion-types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSuggestion(overrides: Partial<VrlSuggestion> & { type: VrlSuggestion["type"] }): VrlSuggestion {
  return {
    id: "s1",
    title: "Test",
    description: "Test",
    priority: "medium",
    code: "",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("parseVrlChatResponse", () => {
  it("parses valid JSON", () => {
    const raw = JSON.stringify({ summary: "OK", suggestions: [] });
    const result = parseVrlChatResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("OK");
  });

  it("parses code-fenced JSON", () => {
    const raw = '```json\n{"summary":"Fenced","suggestions":[]}\n```';
    const result = parseVrlChatResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Fenced");
  });

  it("returns null for malformed JSON", () => {
    expect(parseVrlChatResponse("not valid json")).toBeNull();
  });

  it("returns null for missing summary", () => {
    const raw = JSON.stringify({ suggestions: [] });
    expect(parseVrlChatResponse(raw)).toBeNull();
  });
});

describe("computeVrlSuggestionStatuses", () => {
  it("marks insert_code as always actionable", () => {
    const suggestions = [makeSuggestion({ id: "s1", type: "insert_code", code: ".x = 1" })];
    const statuses = computeVrlSuggestionStatuses(suggestions, "any code");
    expect(statuses.get("s1")).toBe("actionable");
  });

  it("marks replace_code with exact match as actionable", () => {
    const suggestions = [
      makeSuggestion({ id: "s1", type: "replace_code", code: ".x = 2", targetCode: ".x = 1" }),
    ];
    const statuses = computeVrlSuggestionStatuses(suggestions, ".x = 1\n.y = 2");
    expect(statuses.get("s1")).toBe("actionable");
  });

  it("marks replace_code with no match as outdated", () => {
    const suggestions = [
      makeSuggestion({ id: "s1", type: "replace_code", code: ".x = 2", targetCode: ".missing = 1" }),
    ];
    const statuses = computeVrlSuggestionStatuses(suggestions, ".x = 1\n.y = 2");
    expect(statuses.get("s1")).toBe("outdated");
  });

  it("marks applied suggestion as applied", () => {
    const suggestions = [
      makeSuggestion({ id: "s1", type: "replace_code", code: ".x = 2", targetCode: ".x = 1", appliedAt: "2025-01-01" }),
    ];
    const statuses = computeVrlSuggestionStatuses(suggestions, ".x = 1");
    expect(statuses.get("s1")).toBe("applied");
  });

  it("marks replace_code with normalized whitespace match as actionable", () => {
    const suggestions = [
      makeSuggestion({ id: "s1", type: "replace_code", code: ".x = 2", targetCode: ".x  =  1" }),
    ];
    const statuses = computeVrlSuggestionStatuses(suggestions, ".x = 1\n.y = 2");
    expect(statuses.get("s1")).toBe("actionable");
  });
});

describe("applyVrlSuggestion", () => {
  it("insert_code appends to existing code", () => {
    const result = applyVrlSuggestion(
      makeSuggestion({ type: "insert_code", code: ".z = 3" }),
      ".x = 1",
    );
    expect(result).toBe(".x = 1\n.z = 3");
  });

  it("insert_code returns just the code when currentCode is empty", () => {
    const result = applyVrlSuggestion(
      makeSuggestion({ type: "insert_code", code: ".x = 1" }),
      "",
    );
    expect(result).toBe(".x = 1");
  });

  it("replace_code replaces exact match", () => {
    const result = applyVrlSuggestion(
      makeSuggestion({ type: "replace_code", code: ".x = 2", targetCode: ".x = 1" }),
      ".x = 1\n.y = 2",
    );
    expect(result).toBe(".x = 2\n.y = 2");
  });

  it("replace_code replaces normalized whitespace match", () => {
    const result = applyVrlSuggestion(
      makeSuggestion({ type: "replace_code", code: ".x = 2", targetCode: ".x  =  1" }),
      ".x = 1\n.y = 2",
    );
    expect(result).toContain(".x = 2");
    expect(result).toContain(".y = 2");
  });

  it("remove_code removes exact match and collapses blank lines", () => {
    const result = applyVrlSuggestion(
      makeSuggestion({ type: "remove_code", code: "", targetCode: ".remove_me = true" }),
      '.x = 1\n.remove_me = true\n.y = 2',
    );
    expect(result).not.toBeNull();
    expect(result).not.toContain("remove_me");
  });

  it("returns null when targetCode not found for replace_code", () => {
    const result = applyVrlSuggestion(
      makeSuggestion({ type: "replace_code", code: ".x = 2", targetCode: ".nonexistent = 1" }),
      ".x = 1",
    );
    expect(result).toBeNull();
  });

  it("returns null when targetCode not found for remove_code", () => {
    const result = applyVrlSuggestion(
      makeSuggestion({ type: "remove_code", code: "", targetCode: ".nonexistent = 1" }),
      ".x = 1",
    );
    expect(result).toBeNull();
  });
});
