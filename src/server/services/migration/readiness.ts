import type {
  ParsedConfig,
  ReadinessReport,
  ReadinessFactor,
  PluginInfo,
} from "./types";
import { WELL_KNOWN_PLUGINS } from "./types";

/**
 * Compute a readiness score (0-100) for migrating a parsed FluentD config to Vector.
 * This works entirely without AI — based on plugin inventory and complexity metrics.
 */
export function computeReadiness(parsed: ParsedConfig): ReadinessReport {
  const pluginInventory = buildPluginInventory(parsed);
  const factors = computeFactors(parsed, pluginInventory);

  // Weighted average of all factors
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const weightedScore = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const score = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;

  const summary = generateSummary(score, pluginInventory, parsed);

  return { score, summary, factors, pluginInventory };
}

function buildPluginInventory(parsed: ParsedConfig): PluginInfo[] {
  const pluginCounts = new Map<string, { blockType: string; count: number }>();

  for (const block of parsed.blocks) {
    const key = `${block.blockType}:${block.pluginType}`;
    const existing = pluginCounts.get(key);
    if (existing) {
      pluginCounts.set(key, { ...existing, count: existing.count + 1 });
    } else {
      pluginCounts.set(key, { blockType: block.blockType, count: 1 });
    }
  }

  const inventory: PluginInfo[] = [];

  for (const [key, info] of pluginCounts) {
    const pluginType = key.split(":")[1];
    const wellKnown = WELL_KNOWN_PLUGINS[pluginType];

    inventory.push({
      pluginType,
      blockType: info.blockType,
      count: info.count,
      hasVectorEquivalent: !!wellKnown,
      vectorEquivalent: wellKnown?.vectorType ?? null,
      confidence: wellKnown?.confidence ?? 0,
    });
  }

  return inventory;
}

function computeFactors(
  parsed: ParsedConfig,
  pluginInventory: PluginInfo[],
): ReadinessFactor[] {
  const factors: ReadinessFactor[] = [];

  // Factor 1: Plugin coverage (weight: 40)
  const totalPlugins = pluginInventory.length;
  const knownPlugins = pluginInventory.filter((p) => p.hasVectorEquivalent).length;
  const pluginCoverageScore = totalPlugins > 0
    ? Math.round((knownPlugins / totalPlugins) * 100)
    : 100;

  factors.push({
    name: "Plugin Coverage",
    weight: 40,
    score: pluginCoverageScore,
    details: `${knownPlugins} of ${totalPlugins} plugins have known Vector equivalents`,
  });

  // Factor 2: Ruby expression complexity (weight: 25)
  const rubyCount = parsed.complexity.rubyExpressionCount;
  let rubyScore: number;
  if (rubyCount === 0) {
    rubyScore = 100;
  } else if (rubyCount <= 3) {
    rubyScore = 80;
  } else if (rubyCount <= 10) {
    rubyScore = 50;
  } else {
    rubyScore = 20;
  }

  factors.push({
    name: "Ruby Expression Complexity",
    weight: 25,
    score: rubyScore,
    details: `${rubyCount} Ruby expressions found — ${rubyCount === 0 ? "none to translate" : "AI will handle translation to VRL"}`,
  });

  // Factor 3: Routing complexity (weight: 20)
  const branches = parsed.complexity.routingBranches;
  let routingScore: number;
  if (branches <= 3) {
    routingScore = 100;
  } else if (branches <= 8) {
    routingScore = 70;
  } else if (branches <= 15) {
    routingScore = 40;
  } else {
    routingScore = 20;
  }

  factors.push({
    name: "Routing Complexity",
    weight: 20,
    score: routingScore,
    details: `${branches} distinct tag routing patterns`,
  });

  // Factor 4: External dependencies (weight: 15)
  const includeCount = parsed.complexity.includeCount;
  const depScore = includeCount === 0 ? 100 : includeCount <= 2 ? 70 : 30;

  factors.push({
    name: "External Dependencies",
    weight: 15,
    score: depScore,
    details: includeCount === 0
      ? "Self-contained config — no @include directives"
      : `${includeCount} @include directives — external configs not analyzed`,
  });

  return factors;
}

function generateSummary(
  score: number,
  pluginInventory: PluginInfo[],
  parsed: ParsedConfig,
): string {
  const unknownPlugins = pluginInventory
    .filter((p) => !p.hasVectorEquivalent)
    .map((p) => p.pluginType);

  const parts: string[] = [];

  if (score >= 80) {
    parts.push("This config is a strong candidate for automated migration.");
  } else if (score >= 50) {
    parts.push("This config can be partially auto-migrated with some manual adjustments.");
  } else {
    parts.push("This config requires significant manual work to migrate.");
  }

  parts.push(
    `Found ${parsed.complexity.totalBlocks} blocks using ${parsed.complexity.uniquePlugins.length} unique plugins.`,
  );

  if (unknownPlugins.length > 0) {
    parts.push(
      `Unknown plugins (${unknownPlugins.join(", ")}) will need manual mapping or AI assistance.`,
    );
  }

  if (parsed.complexity.rubyExpressionCount > 0) {
    parts.push(
      `${parsed.complexity.rubyExpressionCount} Ruby expressions will be translated to VRL by AI.`,
    );
  }

  if (parsed.complexity.includeCount > 0) {
    parts.push(
      `${parsed.complexity.includeCount} @include directives reference external configs not included in this analysis.`,
    );
  }

  return parts.join(" ");
}
