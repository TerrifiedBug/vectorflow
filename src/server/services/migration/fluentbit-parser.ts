import { nanoid } from "nanoid";
import type { ParsedBlock, ParsedConfig } from "./types";

const SECTION_HEADER = /^\[([A-Za-z0-9_]+)\]\s*$/;
const INCLUDE_DIRECTIVE = /^@include\s+(.+)$/i;
const KEY_VALUE = /^(\S+)\s+(.+)$/;

/**
 * Fluent Bit "classic" INI sections that map onto pipeline ParsedBlocks.
 * The block type uses the same vocabulary as the FluentD IR so the shared
 * readiness / AI-translate / pipeline-generate path consumes both identically:
 *   [INPUT]  -> "source"  (inferKind -> source)
 *   [FILTER] -> "filter"  (inferKind -> transform)
 *   [OUTPUT] -> "match"   (inferKind -> sink)
 */
const SECTION_BLOCK_TYPE: Record<string, ParsedBlock["blockType"]> = {
  INPUT: "source",
  FILTER: "filter",
  OUTPUT: "match",
};

/**
 * Parse a Fluent Bit "classic" (INI-style) configuration string into the same
 * ParsedConfig AST the FluentD parser produces, so the downstream readiness,
 * AI-translation, and pipeline-generation services consume it unchanged.
 *
 * This parser handles:
 * - [SERVICE], [INPUT], [FILTER], [OUTPUT] sections with `Key Value` lines
 * - `Name` key -> pluginType (mirrors FluentD's `@type`)
 * - `Match` key on [FILTER]/[OUTPUT] -> tagPattern (mirrors FluentD's
 *   <match pattern> / <filter pattern> directive argument); the [INPUT] `Tag`
 *   key stays in params, mirroring how FluentD keeps a source's `tag` param
 * - [SERVICE] keys -> globalParams (the daemon-level config, not a pipeline node)
 * - @INCLUDE directives (flagged as external dependencies)
 * - Single and double quoted string values
 * - Comments (lines starting with `#` or `;`)
 *
 * Fluent Bit has no nested sub-sections and no Ruby expressions, so those
 * metrics are always empty — the ParsedConfig shape is identical regardless.
 */
export function parseFluentbitConfig(config: string): ParsedConfig {
  const lines = config.split("\n");
  const blocks: ParsedBlock[] = [];
  const includes: string[] = [];
  const globalParams: Record<string, string> = {};

  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trim();

    // Skip empty lines and comments (# and ; are both Fluent Bit comments)
    if (line === "" || line.startsWith("#") || line.startsWith(";")) {
      lineIndex++;
      continue;
    }

    // Check for @INCLUDE
    const includeMatch = line.match(INCLUDE_DIRECTIVE);
    if (includeMatch) {
      includes.push(includeMatch[1].trim());
      lineIndex++;
      continue;
    }

    // Check for a section header
    const sectionMatch = line.match(SECTION_HEADER);
    if (sectionMatch) {
      const sectionName = sectionMatch[1].toUpperCase();
      const result = parseSection(lines, lineIndex, sectionName);

      if (sectionName === "SERVICE") {
        // [SERVICE] is the global daemon config, not a pipeline node.
        Object.assign(globalParams, result.params);
      } else if (SECTION_BLOCK_TYPE[sectionName] && result.block) {
        blocks.push(result.block);
      }
      // Unknown sections are consumed and ignored.

      lineIndex = result.nextLine;
      continue;
    }

    lineIndex++;
  }

  // Fluent Bit classic INI has no nested sub-sections, so each block is a leaf:
  // totalBlocks == blocks.length and depth is 1 when any block exists.
  const uniquePlugins = [...new Set(blocks.map((b) => b.pluginType))];
  const tagPatterns = blocks
    .filter((b) => b.tagPattern)
    .map((b) => b.tagPattern as string);
  const routingBranches = new Set(tagPatterns).size;

  return {
    blocks,
    includes,
    globalParams,
    complexity: {
      totalBlocks: blocks.length,
      rubyExpressionCount: 0,
      uniquePlugins,
      routingBranches,
      nestedBlockDepth: blocks.length > 0 ? 1 : 0,
      includeCount: includes.length,
    },
  };
}

interface ParseSectionResult {
  /** Pipeline block, or null for non-pipeline sections like [SERVICE]. */
  block: ParsedBlock | null;
  /** Raw key/value pairs of the section (used directly for [SERVICE]). */
  params: Record<string, string>;
  nextLine: number;
}

function parseSection(
  lines: string[],
  startLine: number,
  sectionName: string,
): ParseSectionResult {
  const params: Record<string, string> = {};
  const rawLines: string[] = [lines[startLine]];

  let pluginType: string | null = null;
  let tagPattern: string | null = null;

  let lineIndex = startLine + 1;

  while (lineIndex < lines.length) {
    const raw = lines[lineIndex];
    const line = raw.trim();

    // A new section header or @INCLUDE directive ends the current section
    // (do not consume it — the top-level loop handles both).
    if (SECTION_HEADER.test(line) || INCLUDE_DIRECTIVE.test(line)) {
      break;
    }

    rawLines.push(raw);

    // Skip empty lines and comments
    if (line === "" || line.startsWith("#") || line.startsWith(";")) {
      lineIndex++;
      continue;
    }

    const kv = line.match(KEY_VALUE);
    if (kv) {
      const key = kv[1];
      const value = stripQuotes(kv[2]);
      const lowerKey = key.toLowerCase();

      if (lowerKey === "name") {
        pluginType = value;
      } else if (
        lowerKey === "match" &&
        (sectionName === "FILTER" || sectionName === "OUTPUT")
      ) {
        // The routing tag pattern — mirrors FluentD's <match pattern> arg,
        // which lives in tagPattern rather than params.
        tagPattern = value;
      } else {
        params[key] = value;
      }
    }

    lineIndex++;
  }

  const blockType = SECTION_BLOCK_TYPE[sectionName];
  if (!blockType) {
    // [SERVICE] or unknown section: return params only, no pipeline block.
    return { block: null, params, nextLine: lineIndex };
  }

  const block: ParsedBlock = {
    id: nanoid(12),
    blockType,
    pluginType: pluginType ?? sectionName.toLowerCase(),
    tagPattern,
    labelName: null,
    params,
    nestedBlocks: [],
    rubyExpressions: [],
    rawText: rawLines.join("\n"),
    lineRange: [startLine + 1, lineIndex], // 1-indexed
  };

  return { block, params, nextLine: lineIndex };
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}