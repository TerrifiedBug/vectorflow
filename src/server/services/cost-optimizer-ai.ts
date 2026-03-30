import { prisma } from "@/lib/prisma";
import { getTeamAiConfig } from "@/server/services/ai";
import { debugLog } from "@/lib/logger";

const TAG = "cost-optimizer-ai";

const SYSTEM_PROMPT = `You are a data pipeline cost optimization expert for VectorFlow, a control plane for Vector data pipelines.

You will receive a cost optimization recommendation with analysis data. Your job is to:
1. Write a clear, actionable summary (2-3 sentences) explaining the issue and what to do about it
2. Be specific about which Vector transforms or configuration changes would help
3. Quantify the potential savings when possible

Respond with ONLY the summary text. No markdown formatting, no headers, no bullet points -- just a clear paragraph.`;

interface AiEnrichableRecommendation {
  id: string;
  type: string;
  title: string;
  description: string;
  analysisData: unknown;
  suggestedAction: unknown;
  teamId: string;
  pipeline: { name: string };
}

/** Build the user prompt from a recommendation's analysis data. */
function buildUserPrompt(rec: AiEnrichableRecommendation): string {
  return `Recommendation type: ${rec.type}
Pipeline: ${rec.pipeline.name}
Title: ${rec.title}
Description: ${rec.description}
Analysis data: ${JSON.stringify(rec.analysisData, null, 2)}
Suggested action: ${JSON.stringify(rec.suggestedAction, null, 2)}

Write a concise, actionable summary for this optimization opportunity.`;
}

/**
 * Generate AI summaries for PENDING recommendations that have no aiSummary.
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
      pipeline: { select: { name: true } },
    },
    take: 50, // cap per run to avoid excessive AI calls
  });

  if (recommendations.length === 0) {
    debugLog(TAG, "No recommendations to enrich");
    return 0;
  }

  // Group by teamId
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

    // Process recommendations sequentially per team to respect rate limits
    for (const rec of recs) {
      try {
        const userPrompt = buildUserPrompt(rec);

        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: 300,
            temperature: 0.3,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          console.error(`[${TAG}] AI call failed for rec ${rec.id}: ${response.status} ${errorText}`);
          continue;
        }

        const json = await response.json();
        const aiSummary = json.choices?.[0]?.message?.content?.trim();

        if (aiSummary) {
          await prisma.costRecommendation.update({
            where: { id: rec.id },
            data: { aiSummary },
          });
          enriched++;
        }
      } catch (error) {
        console.error(`[${TAG}] Failed to enrich recommendation ${rec.id}:`, error);
      }
    }
  }

  debugLog(TAG, `AI enrichment complete: ${enriched}/${recommendations.length}`);
  return enriched;
}
