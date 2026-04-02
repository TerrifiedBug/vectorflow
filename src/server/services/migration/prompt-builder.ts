import type { ParsedBlock, ParsedConfig } from "./types";
import { WELL_KNOWN_PLUGINS } from "./types";
import { getVectorCatalog } from "@/lib/vector/catalog";
import type { VectorComponentDef } from "@/lib/vector/types";
import { buildComponentDocsBlock, buildMigrationMappingBlock } from "@/lib/ai/vector-docs-reference";
import { lookupVectorComponent, lookupFluentdPlugin } from "@/server/services/context7";

/**
 * Build a structured AI prompt for translating a single FluentD block to Vector config.
 * The prompt includes:
 * - The FluentD block details (type, params, nested blocks, Ruby expressions)
 * - Context about surrounding blocks (what feeds into this, what this feeds)
 * - Available Vector components matching the likely translation target
 * - Known plugin mapping hints
 * - Instructions for output format
 */
export async function buildBlockTranslationPrompt(params: {
  block: ParsedBlock;
  blockIndex: number;
  totalBlocks: number;
  parsedConfig: ParsedConfig;
}): Promise<string> {
  const { block, blockIndex, totalBlocks, parsedConfig } = params;
  const parts: string[] = [];

  // System context
  parts.push(
    "You are translating a FluentD pipeline block to Vector YAML config for VectorFlow.",
    "Return ONLY a valid JSON object — no markdown fencing, no commentary, no explanation.",
    "",
  );

  // Block context
  parts.push(`## FluentD Block (${blockIndex + 1} of ${totalBlocks})`);
  parts.push(`Directive: <${block.blockType}${block.tagPattern ? ` ${block.tagPattern}` : ""}>`);
  parts.push(`Plugin: ${block.pluginType}`);

  if (block.tagPattern) {
    parts.push(`Tag pattern: ${block.tagPattern}`);
  }

  if (block.labelName) {
    parts.push(`Label: ${block.labelName}`);
  }

  // Parameters
  if (Object.keys(block.params).length > 0) {
    parts.push("", "Parameters:");
    for (const [key, value] of Object.entries(block.params)) {
      parts.push(`  ${key}: ${value}`);
    }
  }

  // Nested blocks
  if (block.nestedBlocks.length > 0) {
    parts.push("", "Nested blocks:");
    for (const nested of block.nestedBlocks) {
      parts.push(`  <${nested.pluginType}>`);
      for (const [key, value] of Object.entries(nested.params)) {
        parts.push(`    ${key}: ${value}`);
      }
    }
  }

  // Ruby expressions
  if (block.rubyExpressions.length > 0) {
    parts.push("", "Ruby expressions found (convert to Vector equivalents):");
    for (const expr of block.rubyExpressions) {
      parts.push(`  ${expr}`);
    }
  }

  // Raw text for full context
  parts.push("", "Original FluentD config text:", "```", block.rawText, "```");

  // Known mapping hint
  const hint = WELL_KNOWN_PLUGINS[block.pluginType];
  if (hint) {
    parts.push(
      "",
      `## Known Mapping Hint`,
      `FluentD "${block.pluginType}" typically maps to Vector "${hint.vectorType}" (${hint.kind}).`,
      `Base confidence: ${hint.confidence}%`,
    );
  }

  // Context7 runtime docs: FluentD source plugin + Vector target component
  const [fluentdDocs, vectorDocs] = await Promise.all([
    lookupFluentdPlugin(block.pluginType),
    hint ? lookupVectorComponent(hint.vectorType, hint.kind) : Promise.resolve(""),
  ]);

  if (fluentdDocs) {
    parts.push("", "## FluentD Plugin Documentation (from docs)", fluentdDocs);
  }
  if (vectorDocs) {
    parts.push("", "## Vector Component Documentation (from docs)", vectorDocs);
  } else if (hint) {
    // Fallback to static reference if Context7 unavailable
    const docsBlock = buildComponentDocsBlock(hint.vectorType, hint.kind);
    if (docsBlock) {
      parts.push("", "## Vector Configuration Reference", docsBlock);
    }
  }

  // Available Vector components
  const relevantComponents = getRelevantVectorComponents(block);
  if (relevantComponents.length > 0) {
    parts.push("", "## Available Vector Components");
    for (const comp of relevantComponents) {
      const configFields = extractConfigFieldSummary(comp);
      parts.push(`${comp.kind}: ${comp.type} — ${comp.description}`);
      if (configFields) {
        parts.push(`  Config fields: ${configFields}`);
      }
    }
  }

  // Topology context — what comes before and after this block
  const topologyContext = buildTopologyContext(block, parsedConfig);
  if (topologyContext) {
    parts.push("", "## Pipeline Context", topologyContext);
  }

  // Output format instructions
  parts.push(
    "",
    "## Output Format",
    "Return a JSON object with these fields:",
    "```json",
    JSON.stringify(
      {
        componentType: "the Vector component type (e.g., 'file', 'elasticsearch', 'remap')",
        componentId:
          "a descriptive snake_case ID (e.g., 'nginx_logs_source', 'es_sink')",
        kind: "source | transform | sink",
        config: {
          "...": "Vector component configuration as key-value pairs",
        },
        inputs: [
          "array of componentId strings this block reads from (empty for sources)",
        ],
        confidence: "0-100 integer — how confident you are in this translation",
        notes: [
          "array of migration caveats or manual steps needed",
        ],
      },
      null,
      2,
    ),
    "```",
    "",
    "## Translation Rules",
    "- Convert Ruby expressions `#{ENV['X']}` to Vector env var syntax `${X}`",
    "- Convert Ruby `#{Socket.gethostname}` to Vector `${HOSTNAME}` or VRL `get_hostname!()`",
    "- Convert FluentD time format patterns (%Y, %m, %d) to Vector strftime equivalents",
    "- For `record_transformer` with `enable_ruby`, generate a `remap` transform with VRL code",
    "- For `grep` filters, generate a Vector `filter` transform with VRL conditions",
    "- For `copy` output with multiple `<store>` blocks, generate multiple sink components",
    "- For `<buffer>` blocks, map to the Vector sink's buffer configuration",
    "- Use the `inputs` field to wire components together based on FluentD tag routing",
    "- If the block cannot be translated, set confidence to 0 and explain in notes",
    "- Return ONLY the JSON object. No surrounding text.",
  );

  return parts.join("\n");
}

/**
 * Build the system prompt for the migration AI translator.
 */
export function buildMigrationSystemPrompt(): string {
  return [
    "You are an expert at translating FluentD pipeline configurations to Vector (vector.dev) configurations.",
    "You understand both FluentD's plugin ecosystem and Vector's component model deeply.",
    "",
    "Key differences to keep in mind:",
    "- FluentD uses tag-based routing; Vector uses explicit `inputs` fields",
    "- FluentD's Ruby expressions need to be converted to VRL (Vector Remap Language) or env vars",
    "- FluentD's `<buffer>` blocks map to Vector sink buffer configuration",
    "- FluentD's `<parse>` blocks often become part of the source config or a remap transform",
    "- FluentD's `<filter>` blocks become Vector transforms",
    "- FluentD's `<match>` blocks become Vector sinks (or transforms + sinks for complex routing)",
    "- FluentD's `out_copy` with multiple `<store>` becomes multiple Vector sinks reading from the same input",
    "",
    "Always output valid JSON. Never include markdown fencing or explanatory text outside the JSON.",
    "",
    buildMigrationMappingBlock(),
  ].join("\n");
}

function getRelevantVectorComponents(block: ParsedBlock): VectorComponentDef[] {
  const catalog = getVectorCatalog();
  const hint = WELL_KNOWN_PLUGINS[block.pluginType];

  const relevantKinds: VectorComponentDef["kind"][] = [];
  if (block.blockType === "source") relevantKinds.push("source");
  if (block.blockType === "match") relevantKinds.push("sink");
  if (block.blockType === "filter") relevantKinds.push("transform");

  // Get the hinted component plus a few related ones
  const components: VectorComponentDef[] = [];

  if (hint) {
    const hinted = catalog.find(
      (c) => c.type === hint.vectorType && c.kind === hint.kind,
    );
    if (hinted) components.push(hinted);
  }

  // Add a few more of the same kind for context
  const sameKindComponents = catalog
    .filter(
      (c) =>
        relevantKinds.includes(c.kind) &&
        !components.some((existing) => existing.type === c.type),
    )
    .slice(0, 5);

  return [...components, ...sameKindComponents];
}

function extractConfigFieldSummary(comp: VectorComponentDef): string | null {
  const schema = comp.configSchema as {
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };

  if (!schema.properties) return null;

  const required = schema.required ?? [];
  const fields = Object.entries(schema.properties)
    .slice(0, 8) // limit to avoid prompt bloat
    .map(([key]) => {
      const isRequired = required.includes(key);
      return `${key}${isRequired ? " (required)" : ""}`;
    });

  return fields.join(", ");
}

function buildTopologyContext(
  block: ParsedBlock,
  parsedConfig: ParsedConfig,
): string | null {
  const parts: string[] = [];

  if (block.blockType === "match" || block.blockType === "filter") {
    // Find sources and filters that produce data matching this block's tag pattern
    const producers = parsedConfig.blocks.filter(
      (b) =>
        b.id !== block.id &&
        (b.blockType === "source" || b.blockType === "filter") &&
        b.params.tag,
    );

    if (producers.length > 0) {
      parts.push(
        "Upstream blocks that may feed into this block:",
      );
      for (const p of producers.slice(0, 5)) {
        parts.push(
          `  - ${p.blockType}/${p.pluginType} (tag: ${p.params.tag ?? "none"})`,
        );
      }
    }
  }

  if (block.blockType === "source" || block.blockType === "filter") {
    // Find matches/filters that consume this block's output
    const consumers = parsedConfig.blocks.filter(
      (b) =>
        b.id !== block.id &&
        (b.blockType === "match" || b.blockType === "filter") &&
        b.tagPattern,
    );

    if (consumers.length > 0) {
      parts.push("Downstream blocks that consume data from this area:");
      for (const c of consumers.slice(0, 5)) {
        parts.push(
          `  - ${c.blockType}/${c.pluginType} (pattern: ${c.tagPattern})`,
        );
      }
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}
