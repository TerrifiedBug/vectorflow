// src/lib/ai/types.ts

export interface AiSuggestionBase {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
}

export interface ModifyConfigSuggestion {
  type: "modify_config";
  componentKey: string;
  changes: Record<string, unknown>;
}

export interface AddComponentSuggestion {
  type: "add_component";
  component: {
    key: string;
    componentType: string;
    kind: "source" | "transform" | "sink";
    config: Record<string, unknown>;
  };
  insertAfter: string;
  connectTo: string[];
}

export interface RemoveComponentSuggestion {
  type: "remove_component";
  componentKey: string;
  reconnect: boolean;
}

export interface ModifyConnectionsSuggestion {
  type: "modify_connections";
  edgeChanges: Array<{
    action: "add" | "remove";
    from: string;
    to: string;
  }>;
}

export type AiSuggestion =
  | (AiSuggestionBase & ModifyConfigSuggestion)
  | (AiSuggestionBase & AddComponentSuggestion)
  | (AiSuggestionBase & RemoveComponentSuggestion)
  | (AiSuggestionBase & ModifyConnectionsSuggestion);

export interface AiReviewResponse {
  summary: string;
  suggestions: AiSuggestion[];
}

/** State of a suggestion in the UI */
export type SuggestionStatus = "actionable" | "applied" | "outdated" | "invalid";
