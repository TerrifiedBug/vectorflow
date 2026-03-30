import { getTeamAiConfig } from "@/server/services/ai";
import { checkRateLimit } from "@/lib/ai/rate-limiter";
import {
  buildBlockTranslationPrompt,
  buildMigrationSystemPrompt,
} from "./prompt-builder";
import { assembleVectorYaml } from "./translation-assembler";
import { validateConfig } from "@/server/services/validator";
import type {
  ParsedBlock,
  ParsedConfig,
  TranslatedBlock,
  TranslationResult,
} from "./types";

const MAX_RETRIES = 2;
const PARALLEL_BATCH_SIZE = 5;

interface TranslateBlocksParams {
  teamId: string;
  parsedConfig: ParsedConfig;
  platform: string;
}

interface TranslateSingleBlockParams {
  teamId: string;
  block: ParsedBlock;
  parsedConfig: ParsedConfig;
  platform: string;
}

/**
 * Translate all parsed FluentD blocks to Vector config using the team's AI provider.
 * Blocks are processed in parallel batches of 5.
 * After assembly, the full config is validated with `vector validate`.
 * On validation failure, errors are fed back to AI for self-correction (max 2 retries).
 */
export async function translateBlocks(
  params: TranslateBlocksParams,
): Promise<TranslationResult> {
  const { teamId, parsedConfig } = params;

  // Filter to translatable blocks (source, match, filter — not system or label wrappers)
  const translatableBlocks = parsedConfig.blocks.filter(
    (b) => b.blockType !== "system" && b.blockType !== "label",
  );

  // For label blocks, extract their inner blocks
  const labelInnerBlocks = parsedConfig.blocks
    .filter((b) => b.blockType === "label")
    .flatMap((b) => b.nestedBlocks);

  const allBlocks = [...translatableBlocks, ...labelInnerBlocks];
  const totalBlocks = allBlocks.length;

  // Translate blocks in parallel batches
  const translatedBlocks: TranslatedBlock[] = [];

  for (let i = 0; i < allBlocks.length; i += PARALLEL_BATCH_SIZE) {
    const batch = allBlocks.slice(i, i + PARALLEL_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((block, batchIdx) =>
        translateOneBlock({
          teamId,
          block,
          blockIndex: i + batchIdx,
          totalBlocks,
          parsedConfig,
        }),
      ),
    );
    translatedBlocks.push(...batchResults);
  }

  // Assemble into full Vector YAML
  let vectorYaml = assembleVectorYaml(translatedBlocks);

  // Validate with vector validate
  let validationResult = await validateConfig(vectorYaml);

  // If validation fails, retry with error feedback (up to MAX_RETRIES)
  let retryCount = 0;
  while (!validationResult.valid && retryCount < MAX_RETRIES) {
    retryCount++;

    // Find blocks with validation errors and retry them
    const errorBlockIds = new Set<string>();
    for (const error of validationResult.errors) {
      if (error.componentKey) {
        const matchingBlock = translatedBlocks.find(
          (b) => b.componentId === error.componentKey,
        );
        if (matchingBlock) {
          errorBlockIds.add(matchingBlock.blockId);
        }
      }
    }

    // If no specific blocks identified, retry all failed blocks
    if (errorBlockIds.size === 0) {
      for (const b of translatedBlocks.filter((b) => b.status === "failed")) {
        errorBlockIds.add(b.blockId);
      }
    }

    // Retry failed blocks with error context
    for (const blockId of errorBlockIds) {
      const originalBlock = allBlocks.find((b) => b.id === blockId);
      if (!originalBlock) continue;

      const blockErrors = validationResult.errors
        .filter((e: { componentKey?: string; message: string }) => {
          const tb = translatedBlocks.find((b) => b.blockId === blockId);
          return tb && e.componentKey === tb.componentId;
        })
        .map((e: { message: string }) => e.message);

      const retranslated = await retranslateWithErrors({
        teamId,
        block: originalBlock,
        blockIndex: allBlocks.indexOf(originalBlock),
        totalBlocks,
        parsedConfig,
        previousErrors: blockErrors,
      });

      // Replace in translated blocks
      const idx = translatedBlocks.findIndex((b) => b.blockId === blockId);
      if (idx !== -1) {
        translatedBlocks[idx] = retranslated;
      }
    }

    // Re-assemble and re-validate
    vectorYaml = assembleVectorYaml(translatedBlocks);
    validationResult = await validateConfig(vectorYaml);
  }

  // Record validation errors on individual blocks
  for (const error of validationResult.errors) {
    if (error.componentKey) {
      const block = translatedBlocks.find(
        (b) => b.componentId === error.componentKey,
      );
      if (block) {
        block.validationErrors.push(error.message);
      }
    }
  }

  const overallConfidence =
    translatedBlocks.length > 0
      ? Math.round(
          translatedBlocks.reduce((sum, b) => sum + b.confidence, 0) /
            translatedBlocks.length,
        )
      : 0;

  const warnings: string[] = [];
  if (!validationResult.valid) {
    warnings.push(
      `Validation failed after ${retryCount} retries. ${validationResult.errors.length} errors remain.`,
    );
  }

  for (const w of validationResult.warnings) {
    warnings.push(w.message);
  }

  return {
    blocks: translatedBlocks,
    vectorYaml,
    overallConfidence,
    warnings,
  };
}

/**
 * Translate a single block (for manual re-translate button).
 */
export async function translateSingleBlock(
  params: TranslateSingleBlockParams,
): Promise<TranslatedBlock> {
  const { teamId, block, parsedConfig } = params;

  return translateOneBlock({
    teamId,
    block,
    blockIndex: 0,
    totalBlocks: 1,
    parsedConfig,
  });
}

async function translateOneBlock(params: {
  teamId: string;
  block: ParsedBlock;
  blockIndex: number;
  totalBlocks: number;
  parsedConfig: ParsedConfig;
}): Promise<TranslatedBlock> {
  const { teamId, block, blockIndex, totalBlocks, parsedConfig } = params;

  const rateLimit = checkRateLimit(teamId);
  if (!rateLimit.allowed) {
    return {
      blockId: block.id,
      componentType: "unknown",
      componentId: `block_${blockIndex}`,
      kind: block.blockType === "source" ? "source" : block.blockType === "filter" ? "transform" : "sink",
      config: {},
      inputs: [],
      confidence: 0,
      notes: ["Rate limit exceeded — try again later"],
      validationErrors: [],
      status: "failed",
    };
  }

  const prompt = buildBlockTranslationPrompt({
    block,
    blockIndex,
    totalBlocks,
    parsedConfig,
  });

  const systemPrompt = buildMigrationSystemPrompt();

  try {
    const response = await callAiCompletion({
      teamId,
      systemPrompt,
      userPrompt: prompt,
    });

    const parsed = parseAiResponse(response, block);
    return parsed;
  } catch (err) {
    return {
      blockId: block.id,
      componentType: "unknown",
      componentId: `block_${blockIndex}`,
      kind: block.blockType === "source" ? "source" : block.blockType === "filter" ? "transform" : "sink",
      config: {},
      inputs: [],
      confidence: 0,
      notes: [
        `AI translation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      ],
      validationErrors: [],
      status: "failed",
    };
  }
}

async function retranslateWithErrors(params: {
  teamId: string;
  block: ParsedBlock;
  blockIndex: number;
  totalBlocks: number;
  parsedConfig: ParsedConfig;
  previousErrors: string[];
}): Promise<TranslatedBlock> {
  const { teamId, block, blockIndex, totalBlocks, parsedConfig, previousErrors } =
    params;

  const basePrompt = buildBlockTranslationPrompt({
    block,
    blockIndex,
    totalBlocks,
    parsedConfig,
  });

  const errorContext = [
    "",
    "## PREVIOUS TRANSLATION FAILED VALIDATION",
    "The previous translation produced these `vector validate` errors:",
    ...previousErrors.map((e) => `  - ${e}`),
    "",
    "Fix these errors in your new translation. Pay close attention to:",
    "- Required fields that may be missing",
    "- Field names that may differ between FluentD and Vector",
    "- Input references that may not exist",
  ].join("\n");

  const promptWithErrors = basePrompt + "\n" + errorContext;
  const systemPrompt = buildMigrationSystemPrompt();

  try {
    const response = await callAiCompletion({
      teamId,
      systemPrompt,
      userPrompt: promptWithErrors,
    });

    return parseAiResponse(response, block);
  } catch (err) {
    return {
      blockId: block.id,
      componentType: "unknown",
      componentId: `block_${blockIndex}`,
      kind: block.blockType === "source" ? "source" : block.blockType === "filter" ? "transform" : "sink",
      config: {},
      inputs: [],
      confidence: 0,
      notes: [
        `AI retry failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      ],
      validationErrors: [],
      status: "failed",
    };
  }
}

async function callAiCompletion(params: {
  teamId: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const { teamId, systemPrompt, userPrompt } = params;
  const config = await getTeamAiConfig(teamId);

  // Validate base URL to prevent SSRF
  const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
  const parsed = new URL(config.baseUrl);
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("AI base URL must use http or https");
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2, // Lower temperature for more deterministic translation
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`AI provider error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Empty response from AI provider");
  }

  return content;
}

function parseAiResponse(
  response: string,
  block: ParsedBlock,
): TranslatedBlock {
  // Strip markdown code fences if present
  let cleanResponse = response.trim();
  if (cleanResponse.startsWith("```json")) {
    cleanResponse = cleanResponse.slice(7);
  } else if (cleanResponse.startsWith("```")) {
    cleanResponse = cleanResponse.slice(3);
  }
  if (cleanResponse.endsWith("```")) {
    cleanResponse = cleanResponse.slice(0, -3);
  }
  cleanResponse = cleanResponse.trim();

  let parsed: {
    componentType?: string;
    componentId?: string;
    kind?: string;
    config?: Record<string, unknown>;
    inputs?: string[];
    confidence?: number;
    notes?: string[];
  };

  try {
    parsed = JSON.parse(cleanResponse);
  } catch {
    // Try to extract JSON from response
    const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error("Failed to parse AI response as JSON");
      }
    } else {
      throw new Error("AI response is not valid JSON");
    }
  }

  return {
    blockId: block.id,
    componentType: parsed.componentType ?? "unknown",
    componentId: parsed.componentId ?? `block_${block.id}`,
    kind: (parsed.kind as "source" | "transform" | "sink") ?? inferKind(block),
    config: parsed.config ?? {},
    inputs: parsed.inputs ?? [],
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    validationErrors: [],
    status: "translated",
  };
}

function inferKind(block: ParsedBlock): "source" | "transform" | "sink" {
  switch (block.blockType) {
    case "source":
      return "source";
    case "filter":
      return "transform";
    case "match":
      return "sink";
    default:
      return "transform";
  }
}
