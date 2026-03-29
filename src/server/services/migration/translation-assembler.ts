import yaml from "js-yaml";
import type { TranslatedBlock } from "./types";

/**
 * Assemble translated blocks into a complete Vector YAML config string.
 * Groups blocks by kind (sources, transforms, sinks) per Vector convention.
 */
export function assembleVectorYaml(blocks: TranslatedBlock[]): string {
  const sources: Record<string, Record<string, unknown>> = {};
  const transforms: Record<string, Record<string, unknown>> = {};
  const sinks: Record<string, Record<string, unknown>> = {};

  for (const block of blocks) {
    if (block.status === "failed" || block.status === "skipped") continue;

    const config = { ...block.config };

    // Add inputs for transforms and sinks
    if (block.kind !== "source" && block.inputs.length > 0) {
      config.inputs = block.inputs;
    }

    // Add type field
    config.type = block.componentType;

    switch (block.kind) {
      case "source":
        sources[block.componentId] = config;
        break;
      case "transform":
        transforms[block.componentId] = config;
        break;
      case "sink":
        sinks[block.componentId] = config;
        break;
    }
  }

  const vectorConfig: Record<string, unknown> = {};

  if (Object.keys(sources).length > 0) {
    vectorConfig.sources = sources;
  }
  if (Object.keys(transforms).length > 0) {
    vectorConfig.transforms = transforms;
  }
  if (Object.keys(sinks).length > 0) {
    vectorConfig.sinks = sinks;
  }

  return yaml.dump(vectorConfig, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}
