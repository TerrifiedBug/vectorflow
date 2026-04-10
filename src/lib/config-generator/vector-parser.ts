import yaml from "js-yaml";
import { parse as parseToml } from "smol-toml";
import { findComponentDef } from "@/lib/vector/catalog";

/** Top-level keys that represent the pipeline graph — everything else is globalConfig */
const GRAPH_SECTIONS = new Set(["sources", "transforms", "sinks"]);

/**
 * Known field renames across Vector versions.
 * Key: old field name, Value: { newName, kinds (which component kinds it applies to) }
 */
const FIELD_RENAMES: Record<string, { newName: string; kinds: Set<string> }> = {
  fingerprinting: { newName: "fingerprint", kinds: new Set(["source"]) },
};

export interface ParsedComponent {
  componentKey: string;
  componentType: string;
  kind: "source" | "transform" | "sink";
  config: Record<string, unknown>;
  inputs: string[];
  catalogMatch: boolean;
}

export interface ParseResult {
  components: ParsedComponent[];
  globalConfig: Record<string, unknown> | null;
  warnings: string[];
}

/**
 * Detect whether content is TOML or YAML.
 * TOML configs use `[section.key]` style headers; YAML uses `key:` style.
 * We look for the presence of `[sources.`, `[transforms.`, or `[sinks.` as
 * a reliable TOML indicator.
 */
function detectFormat(content: string): "yaml" | "toml" {
  if (/^\s*\[(sources|transforms|sinks)\./m.test(content)) {
    return "toml";
  }
  return "yaml";
}

/**
 * Convert request.headers.Authorization bearer/basic tokens into Vector's
 * canonical `auth` structure so the GUI auth fields are populated correctly.
 *
 * Handles:
 *  - request.headers.Authorization: "Bearer <token>" → auth.strategy=bearer, auth.token=<token>
 *  - request.headers.Authorization: "Basic <b64>"    → auth.strategy=basic, auth.user/password (decoded)
 */
function normaliseAuth(config: Record<string, unknown>): void {
  const request = config.request as Record<string, unknown> | undefined;
  const headers = request?.headers as Record<string, unknown> | undefined;
  const authHeader = headers?.Authorization as string | undefined;
  if (!authHeader || typeof authHeader !== "string") return;

  // Already has an explicit auth block — don't overwrite
  const auth = config.auth as Record<string, unknown> | undefined;
  if (auth?.strategy) return;

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    config.auth = { strategy: "bearer", token };
  } else if (authHeader.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice("Basic ".length).trim());
    const colonIdx = decoded.indexOf(":");
    if (colonIdx > -1) {
      config.auth = {
        strategy: "basic",
        user: decoded.slice(0, colonIdx),
        password: decoded.slice(colonIdx + 1),
      };
    }
  }

  // Remove the Authorization header since auth is now in the dedicated block
  delete (headers as Record<string, unknown>).Authorization;
  // Clean up empty headers/request objects
  if (Object.keys(headers as Record<string, unknown>).length === 0) {
    delete (request as Record<string, unknown>).headers;
  }
  if (Object.keys(request as Record<string, unknown>).length === 0) {
    delete config.request;
  }
}

/**
 * Rename deprecated Vector config fields to their current names.
 */
function normaliseFieldNames(config: Record<string, unknown>, kind: string): void {
  for (const [oldName, { newName, kinds }] of Object.entries(FIELD_RENAMES)) {
    if (kinds.has(kind) && oldName in config && !(newName in config)) {
      config[newName] = config[oldName];
      delete config[oldName];
    }
  }
}

/**
 * Parse a Vector config string (YAML or TOML) and return a normalized
 * intermediate representation as a graph of components.
 *
 * Unlike `importVectorConfig`, this function has no dependency on React Flow
 * or layout algorithms — it is purely a data transformation.
 *
 * @param content - Raw config file contents
 * @param format  - "yaml" | "toml", or omit to auto-detect
 * @throws if content is empty or fails to parse
 */
export function parseVectorConfig(
  content: string,
  format?: "yaml" | "toml",
): ParseResult {
  if (!content || !content.trim()) {
    throw new Error("Config content must not be empty");
  }

  const resolvedFormat = format ?? detectFormat(content);

  let raw: Record<string, unknown>;
  if (resolvedFormat === "toml") {
    raw = parseToml(content) as Record<string, unknown>;
  } else {
    raw = yaml.load(content) as Record<string, unknown>;
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Failed to parse config: result is not an object");
  }

  // Extract global config — everything that isn't sources/transforms/sinks
  const globalConfigRaw: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!GRAPH_SECTIONS.has(key)) {
      globalConfigRaw[key] = raw[key];
    }
  }

  const components: ParsedComponent[] = [];

  const sections: Array<[string, "source" | "transform" | "sink"]> = [
    ["sources", "source"],
    ["transforms", "transform"],
    ["sinks", "sink"],
  ];

  for (const [section, kind] of sections) {
    const sectionData = (raw[section] ?? {}) as Record<string, Record<string, unknown>>;

    for (const [componentKey, value] of Object.entries(sectionData)) {
      const componentType: string = (value.type as string) || componentKey;

      // Strip `type` and `inputs` — they are structural, not user config
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { type: _type, inputs: _inputs, ...config } = value;

      // Normalise deprecated field names (e.g. fingerprinting → fingerprint)
      normaliseFieldNames(config, kind);

      // Normalise auth: convert request.headers.Authorization bearer/basic tokens
      // into the canonical auth: { strategy, token } structure
      normaliseAuth(config);

      // Collect inputs list (sources always have empty inputs)
      const inputs: string[] = Array.isArray(value.inputs)
        ? (value.inputs as string[])
        : value.inputs
          ? [value.inputs as string]
          : [];

      // Check catalog match
      const catalogMatch = findComponentDef(componentType, kind) !== undefined;

      components.push({
        componentKey,
        componentType,
        kind,
        config,
        inputs,
        catalogMatch,
      });
    }
  }

  // ── Orphan detection ──────────────────────────────────────────────────
  const warnings: string[] = [];

  // Build set of all component keys and the set of keys referenced as inputs
  const allKeys = new Set(components.map((c) => c.componentKey));
  const referencedAsInput = new Set(components.flatMap((c) => c.inputs));

  for (const comp of components) {
    if (comp.kind === "source") {
      // Orphan source: no other component lists it as an input
      if (!referencedAsInput.has(comp.componentKey)) {
        warnings.push(
          `Orphan source "${comp.componentKey}": no downstream consumers reference it`,
        );
      }
    } else if (comp.kind === "sink") {
      // Orphan sink: has no inputs defined, or inputs don't reference known components
      const hasValidInput = comp.inputs.some((inp) => allKeys.has(inp));
      if (!hasValidInput) {
        warnings.push(
          `Orphan sink "${comp.componentKey}": no upstream inputs are defined or connected`,
        );
      }
    }
  }

  return {
    components,
    globalConfig: Object.keys(globalConfigRaw).length > 0 ? globalConfigRaw : null,
    warnings,
  };
}
