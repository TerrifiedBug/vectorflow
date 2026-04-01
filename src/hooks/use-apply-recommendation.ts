import { useState, useCallback } from "react";

export function useApplyRecommendation() {
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<
    string | null
  >(null);

  const openApplyModal = useCallback((recommendationId: string) => {
    setSelectedRecommendationId(recommendationId);
  }, []);

  const closeApplyModal = useCallback(() => {
    setSelectedRecommendationId(null);
  }, []);

  return {
    selectedRecommendationId,
    openApplyModal,
    closeApplyModal,
  };
}
