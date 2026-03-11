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

/**
 * Parse the streamed AI response as a VrlChatResponse.
 * Returns null if the response is not valid JSON or missing required fields.
 */
export function parseVrlChatResponse(raw: string): VrlChatResponse | null {
  try {
    const parsed = JSON.parse(raw);
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
    if (s.targetCode && currentCode.includes(s.targetCode)) {
      statuses.set(s.id, "actionable");
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

    case "replace_code":
      if (!suggestion.targetCode || !currentCode.includes(suggestion.targetCode)) {
        return null;
      }
      return currentCode.replaceAll(suggestion.targetCode, suggestion.code);

    case "remove_code":
      if (!suggestion.targetCode || !currentCode.includes(suggestion.targetCode)) {
        return null;
      }
      return currentCode.replaceAll(suggestion.targetCode, "").replace(/\n{3,}/g, "\n\n").trim();

    default:
      return null;
  }
}
