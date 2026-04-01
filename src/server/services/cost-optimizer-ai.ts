import { prisma } from "@/lib/prisma";
import { getTeamAiConfig } from "@/server/services/ai";
import { buildCostRecommendationPrompt } from "@/lib/ai/cost-recommendation-prompt";
import { parseAiReviewResponse } from "@/lib/ai/suggestion-validator";
import { debugLog, errorLog } from "@/lib/logger";
import { Prisma } from "@/generated/prisma";

const TAG = "cost-optimizer-ai";

/**
 * Generate AI summaries and structured suggestions for PENDING recommendations.
 * Groups by team to use the correct AI provider per team.
 * Returns the count of successfully enriched recommendations.
 */
export async function generateAiRecommendations(): Promise<number> {
  const recommendations = await prisma.costRecommendation.findMany({
    where: {
      status: "PENDING",
      aiSummary: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      pipeline: {
        select: {
          name: true,
          nodes: {
            select: {
              componentKey: true,
              componentType: true,
              kind: true,
              config: true,
            },
          },
        },
      },
    },
    take: 50,
  });

  if (recommendations.length === 0) {
    debugLog(TAG, "No recommendations to enrich");
    return 0;
  }

  const byTeam = new Map<string, typeof recommendations>();
  for (const rec of recommendations) {
    const group = byTeam.get(rec.teamId) ?? [];
    group.push(rec);
    byTeam.set(rec.teamId, group);
  }

  let enriched = 0;

  for (const [teamId, recs] of byTeam) {
    let config;
    try {
      config = await getTeamAiConfig(teamId);
    } catch {
      debugLog(TAG, `AI not configured for team ${teamId}, skipping ${recs.length} recommendations`);
      continue;
    }

    for (const rec of recs) {
      try {
        const prompts = buildCostRecommendationPrompt({
          type: rec.type,
          title: rec.title,
          description: rec.description,
          analysisData: rec.analysisData as Record<string, unknown>,
          suggestedAction: rec.suggestedAction,
          pipelineName: rec.pipeline.name,
          nodes: rec.pipeline.nodes.map((n) => ({
            componentKey: n.componentKey,
            componentType: n.componentType,
            kind: n.kind,
            config: n.config,
          })),
        });

        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: 1500,
            temperature: 0.3,
            messages: [
              { role: "system", content: prompts.system },
              { role: "user", content: prompts.user },
            ],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          errorLog(TAG, `AI call failed for rec ${rec.id}: ${response.status} ${errorText}`);
          continue;
        }

        const json = await response.json();
        const rawContent = json.choices?.[0]?.message?.content?.trim();

        if (!rawContent) continue;

        const parsed = parseAiReviewResponse(rawContent);

        const updateData: Record<string, unknown> = {};

        if (parsed) {
          updateData.aiSummary = parsed.summary;
          if (parsed.suggestions.length > 0) {
            updateData.aiSuggestions = parsed.suggestions as unknown as Prisma.InputJsonValue;
          }
        } else {
          updateData.aiSummary = rawContent;
        }

        await prisma.costRecommendation.update({
          where: { id: rec.id },
          data: updateData,
        });
        enriched++;
      } catch (error) {
        errorLog(TAG, `Failed to enrich recommendation ${rec.id}`, error);
      }
    }
  }

  debugLog(TAG, `AI enrichment complete: ${enriched}/${recommendations.length}`);
  return enriched;
}
