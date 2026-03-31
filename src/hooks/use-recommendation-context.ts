import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import type { AiSuggestion } from "@/lib/ai/types";

interface SuggestedAction {
  type: "add_sampling" | "add_filter" | "remove_sink" | "disable_pipeline";
  config: Record<string, unknown>;
}

/**
 * Hook that reads the `recommendation` query param from the URL
 * and fetches the corresponding CostRecommendation with its
 * AI-generated pipeline suggestions.
 */
export function useRecommendationContext(environmentId: string) {
  const searchParams = useSearchParams();
  const recommendationId = searchParams.get("recommendation");
  const trpc = useTRPC();

  const query = useQuery(
    trpc.costRecommendation.getById.queryOptions(
      { environmentId, id: recommendationId ?? "" },
      { enabled: !!recommendationId },
    ),
  );

  const aiSuggestions = useMemo<AiSuggestion[]>(() => {
    if (!query.data?.aiSuggestions) return [];
    try {
      const raw = query.data.aiSuggestions;
      if (Array.isArray(raw)) return raw as unknown as AiSuggestion[];
      return [];
    } catch {
      return [];
    }
  }, [query.data?.aiSuggestions]);

  useEffect(() => {
    if (query.data) {
      const suggestionCount = aiSuggestions.length;
      if (suggestionCount > 0) {
        toast.info(
          `${suggestionCount} suggested change${suggestionCount > 1 ? "s" : ""} ready to apply`,
          { duration: 8000 },
        );
      } else {
        const action = query.data.suggestedAction as SuggestedAction | null;
        if (action) {
          const actionLabels: Record<string, string> = {
            add_sampling: "Add a sampling transform to reduce data volume",
            add_filter: "Add a filter transform to drop unwanted events",
            remove_sink: "Remove a duplicate sink",
            disable_pipeline: "Consider disabling this stale pipeline",
          };
          toast.info(
            actionLabels[action.type] ?? "Review the suggested optimization",
            { duration: 8000 },
          );
        }
      }
    }
  }, [query.data, aiSuggestions.length]);

  if (!recommendationId) return null;

  return {
    recommendation: query.data ?? null,
    isLoading: query.isLoading,
    suggestedAction: (query.data?.suggestedAction as unknown as SuggestedAction) ?? null,
    aiSuggestions,
  };
}
