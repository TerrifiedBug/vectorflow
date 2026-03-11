export interface VrlSuggestion {
  id: string;
  type: "insert_code" | "replace_code" | "remove_code";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  code: string;
  targetCode?: string;
  appliedAt?: string;
  appliedById?: string;
}

export interface VrlChatResponse {
  summary: string;
  suggestions: VrlSuggestion[];
}

/** Status of a VRL suggestion in the UI */
export type VrlSuggestionStatus = "actionable" | "applied" | "outdated";

/** Strip markdown code fences and extract the JSON body. */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  // Match ```json ... ``` or ``` ... ```
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Parse the streamed AI response as a VrlChatResponse.
 * Returns null if the response is not valid JSON or missing required fields.
 */
export function parseVrlChatResponse(raw: string): VrlChatResponse | null {
  try {
    const parsed = JSON.parse(stripCodeFences(raw));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.summary === "string" &&
      Array.isArray(parsed.suggestions)
    ) {
      return parsed as VrlChatResponse;
    }
    return null;
  } catch {
    return null;
  }
}

/** Collapse all whitespace runs to single space and trim. */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Find a substring match using normalized whitespace comparison.
 * Returns the original start/end indices in haystack, or null.
 */
function findNormalizedMatch(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  const normNeedle = normalizeWhitespace(needle);
  if (!normNeedle) return null;

  // Slide start through haystack
  for (let start = 0; start < haystack.length; start++) {
    // Try windows of varying length around the expected needle length (±10 chars)
    const minEnd = Math.max(start + 1, start + needle.length - 10);
    const maxEnd = Math.min(haystack.length, start + needle.length + 10);
    for (let end = minEnd; end <= maxEnd; end++) {
      if (normalizeWhitespace(haystack.slice(start, end)) === normNeedle) {
        return { start, end };
      }
    }
  }
  return null;
}

/**
 * Compute the status of each VRL suggestion based on the current editor content.
 *
 * - insert_code: always actionable (no targetCode to become stale)
 * - replace_code / remove_code: actionable if targetCode is found in currentCode, otherwise outdated
 * - Any suggestion with appliedAt is marked as applied
 */
export function computeVrlSuggestionStatuses(
  suggestions: VrlSuggestion[],
  currentCode: string,
): Map<string, VrlSuggestionStatus> {
  const statuses = new Map<string, VrlSuggestionStatus>();

  for (const s of suggestions) {
    if (s.appliedAt) {
      statuses.set(s.id, "applied");
      continue;
    }

    if (s.type === "insert_code") {
      statuses.set(s.id, "actionable");
      continue;
    }

    // replace_code and remove_code: check if targetCode exists in current editor
    if (s.targetCode) {
      // Fast path: exact match
      if (currentCode.includes(s.targetCode)) {
        statuses.set(s.id, "actionable");
      // Fallback: normalized whitespace match
      } else if (findNormalizedMatch(currentCode, s.targetCode)) {
        statuses.set(s.id, "actionable");
      } else {
        statuses.set(s.id, "outdated");
      }
    } else {
      statuses.set(s.id, "outdated");
    }
  }

  return statuses;
}

/**
 * Apply a single VRL suggestion to the editor content.
 * Returns the new code, or null if the suggestion can't be applied (targetCode not found).
 */
export function applyVrlSuggestion(
  suggestion: VrlSuggestion,
  currentCode: string,
): string | null {
  switch (suggestion.type) {
    case "insert_code":
      return currentCode
        ? `${currentCode}\n${suggestion.code}`
        : suggestion.code;

    case "replace_code": {
      if (!suggestion.targetCode) return null;
      // Fast path: exact match
      if (currentCode.includes(suggestion.targetCode)) {
        return currentCode.replaceAll(suggestion.targetCode, suggestion.code);
      }
      // Fallback: normalized whitespace match
      const match = findNormalizedMatch(currentCode, suggestion.targetCode);
      if (!match) return null;
      return currentCode.slice(0, match.start) + suggestion.code + currentCode.slice(match.end);
    }

    case "remove_code": {
      if (!suggestion.targetCode) return null;
      // Fast path: exact match
      if (currentCode.includes(suggestion.targetCode)) {
        return currentCode.replaceAll(suggestion.targetCode, "").replace(/\n{3,}/g, "\n\n").trim();
      }
      // Fallback: normalized whitespace match
      const match = findNormalizedMatch(currentCode, suggestion.targetCode);
      if (!match) return null;
      const removed = currentCode.slice(0, match.start) + currentCode.slice(match.end);
      return removed.replace(/\n{3,}/g, "\n\n").trim();
    }

    default:
      return null;
  }
}
