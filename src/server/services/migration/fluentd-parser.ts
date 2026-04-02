import { nanoid } from "nanoid";
import type { ParsedBlock, ParsedConfig } from "./types";

const DIRECTIVE_OPEN = /^<(\w+)\s*(.*)>\s*$/;
const DIRECTIVE_CLOSE = /^<\/(\w+)\s*>\s*$/;
const INCLUDE_DIRECTIVE = /^@include\s+(.+)$/;
const PARAM_LINE = /^(\S+)\s+(.+)$/;
const RUBY_EXPRESSION = /#\{[^}]+\}/g;

const BLOCK_TYPES = new Set(["source", "match", "filter", "label", "system"]);
const NESTED_BLOCK_TYPES = new Set([
  "parse", "format", "buffer", "store", "server", "secondary",
  "inject", "extract", "record", "pattern", "section",
  "rule", "regexp", "exclude", "and", "or",
]);

/**
 * Parse a FluentD configuration string into a structured AST.
 *
 * This parser handles:
 * - Top-level <source>, <match>, <filter>, <label>, <system> blocks
 * - Nested <parse>, <format>, <buffer>, <store>, <server>, <secondary> sub-blocks
 * - @type, @label, @id special parameters
 * - Tag patterns from <match pattern> and <filter pattern>
 * - Ruby expressions #{...} in parameter values (flagged, not evaluated)
 * - @include directives (flagged as external dependencies)
 * - Global parameters (outside any block)
 * - Single and double quoted string values
 * - Comments (lines starting with #)
 */
export function parseFluentdConfig(config: string): ParsedConfig {
  const lines = config.split("\n");
  const blocks: ParsedBlock[] = [];
  const includes: string[] = [];
  const globalParams: Record<string, string> = {};

  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trim();

    // Skip empty lines and comments
    if (line === "" || line.startsWith("#")) {
      lineIndex++;
      continue;
    }

    // Check for @include
    const includeMatch = line.match(INCLUDE_DIRECTIVE);
    if (includeMatch) {
      includes.push(includeMatch[1].trim());
      lineIndex++;
      continue;
    }

    // Check for directive open
    const openMatch = line.match(DIRECTIVE_OPEN);
    if (openMatch) {
      const directiveName = openMatch[1].toLowerCase();
      const directiveArg = openMatch[2].trim();

      if (BLOCK_TYPES.has(directiveName) || NESTED_BLOCK_TYPES.has(directiveName)) {
        const result = parseBlock(lines, lineIndex, directiveName, directiveArg);
        blocks.push(result.block);
        lineIndex = result.nextLine;
        continue;
      }
    }

    // Global parameter (outside any block)
    const paramMatch = line.match(PARAM_LINE);
    if (paramMatch) {
      globalParams[paramMatch[1]] = stripQuotes(paramMatch[2]);
    }

    lineIndex++;
  }

  const allRubyExpressions = blocks.flatMap((b) => collectRubyExpressions(b));
  const allPlugins = blocks.flatMap((b) => collectPluginTypes(b));
  const uniquePlugins = [...new Set(allPlugins)];
  const tagPatterns = blocks
    .filter((b) => b.tagPattern)
    .map((b) => b.tagPattern as string);
  const routingBranches = new Set(tagPatterns).size;
  const maxDepth = blocks.reduce((max, b) => Math.max(max, computeDepth(b)), 0);

  return {
    blocks,
    includes,
    globalParams,
    complexity: {
      totalBlocks: countAllBlocks(blocks),
      rubyExpressionCount: allRubyExpressions.length,
      uniquePlugins,
      routingBranches,
      nestedBlockDepth: maxDepth,
      includeCount: includes.length,
    },
  };
}

interface ParseBlockResult {
  block: ParsedBlock;
  nextLine: number;
}

function parseBlock(
  lines: string[],
  startLine: number,
  directiveName: string,
  directiveArg: string,
): ParseBlockResult {
  const params: Record<string, string> = {};
  const nestedBlocks: ParsedBlock[] = [];
  const rubyExpressions: string[] = [];
  const rawLines: string[] = [lines[startLine]];

  // Determine block type and extract tag/label
  let blockType: ParsedBlock["blockType"] = "source";
  let tagPattern: string | null = null;
  let labelName: string | null = null;

  if (BLOCK_TYPES.has(directiveName)) {
    blockType = directiveName as ParsedBlock["blockType"];
  } else {
    // Nested blocks treated as the directive name (parse, buffer, etc.)
    // We store them as "source" type with the directive name as pluginType
    // Actually, nested blocks get their blockType from context
    blockType = "source"; // will be overridden by parent context
  }

  if (directiveName === "match" || directiveName === "filter") {
    tagPattern = directiveArg || null;
  } else if (directiveName === "label") {
    labelName = directiveArg || null;
  }

  let lineIndex = startLine + 1;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trim();
    rawLines.push(lines[lineIndex]);

    // Skip empty lines and comments
    if (line === "" || line.startsWith("#")) {
      lineIndex++;
      continue;
    }

    // Check for closing directive
    const closeMatch = line.match(DIRECTIVE_CLOSE);
    if (closeMatch && closeMatch[1].toLowerCase() === directiveName) {
      lineIndex++;
      break;
    }

    // Check for nested directive open
    const openMatch = line.match(DIRECTIVE_OPEN);
    if (openMatch) {
      const nestedName = openMatch[1].toLowerCase();
      const nestedArg = openMatch[2].trim();

      if (NESTED_BLOCK_TYPES.has(nestedName) || BLOCK_TYPES.has(nestedName)) {
        const result = parseBlock(lines, lineIndex, nestedName, nestedArg);
        nestedBlocks.push(result.block);
        // Add raw lines from nested block
        for (let i = lineIndex + 1; i < result.nextLine; i++) {
          rawLines.push(lines[i]);
        }
        lineIndex = result.nextLine;
        continue;
      }
    }

    // Parse parameter line
    const paramMatch = line.match(PARAM_LINE);
    if (paramMatch) {
      const key = paramMatch[1];
      const value = stripQuotes(paramMatch[2]);
      params[key] = value;

      // Check for Ruby expressions in the value
      const rubyMatches = value.match(RUBY_EXPRESSION);
      if (rubyMatches) {
        rubyExpressions.push(...rubyMatches);
      }
    }

    lineIndex++;
  }

  // Extract @type from params
  const pluginType = params["@type"] ?? params["type"] ?? directiveName;
  delete params["@type"];
  delete params["type"];

  // Extract @id and @label from params
  if (params["@id"]) {
    // Keep in params for reference
  }
  if (params["@label"]) {
    labelName = params["@label"];
    delete params["@label"];
  }

  const block: ParsedBlock = {
    id: nanoid(12),
    blockType,
    pluginType,
    tagPattern,
    labelName,
    params,
    nestedBlocks,
    rubyExpressions,
    rawText: rawLines.join("\n"),
    lineRange: [startLine + 1, lineIndex], // 1-indexed
  };

  return { block, nextLine: lineIndex };
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

function collectRubyExpressions(block: ParsedBlock): string[] {
  const expressions = [...block.rubyExpressions];
  for (const nested of block.nestedBlocks) {
    expressions.push(...collectRubyExpressions(nested));
  }
  return expressions;
}

function collectPluginTypes(block: ParsedBlock): string[] {
  const plugins = [block.pluginType];
  for (const nested of block.nestedBlocks) {
    plugins.push(...collectPluginTypes(nested));
  }
  return plugins;
}

function countAllBlocks(blocks: ParsedBlock[]): number {
  let count = 0;
  for (const block of blocks) {
    count += 1;
    count += countAllBlocks(block.nestedBlocks);
  }
  return count;
}

function computeDepth(block: ParsedBlock): number {
  if (block.nestedBlocks.length === 0) return 1;
  return 1 + Math.max(...block.nestedBlocks.map(computeDepth));
}
