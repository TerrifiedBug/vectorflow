import yaml from "js-yaml";
import type { SuggestedAction } from "@/server/services/cost-optimizer-types";
import { renderTailSampleBlocks } from "@/lib/vector/tail-sample";

export function applyRecommendationToYaml(
  currentYaml: string,
  action: SuggestedAction,
  targetSinkKey: string,
): string | null {
  switch (action.type) {
    case "add_sampling":
      return applyAddTransform(currentYaml, {
        componentKey: action.config.componentKey,
        type: "sample",
        config: { rate: action.config.rate },
        targetSinkKey,
      });
    case "add_filter":
      return applyAddTransform(currentYaml, {
        componentKey: action.config.componentKey,
        type: "filter",
        config: { condition: action.config.condition },
        targetSinkKey,
      });
    case "drop_field":
      return applyAddTransform(currentYaml, {
        componentKey: action.config.componentKey,
        type: "remap",
        config: { source: dropFieldsVrl(action.config.fields) },
        targetSinkKey,
      });
    case "tail_sample":
      return applyTailSample(currentYaml, action.config, targetSinkKey);
    case "disable_pipeline":
      return null;
  }
}

/**
 * Build a VRL `remap` source that deletes each offending field. Field names are
 * emitted as quoted VRL paths (`del(."field")`) via JSON.stringify so names
 * containing dots/quotes/dashes are escaped safely.
 */
export function dropFieldsVrl(fields: readonly string[]): string {
  return fields.map((field) => `del(.${JSON.stringify(field)})`).join("\n");
}

interface AddTransformParams {
  componentKey: string;
  type: string;
  config: Record<string, unknown>;
  targetSinkKey: string;
}

function applyAddTransform(currentYaml: string, params: AddTransformParams): string {
  if (!currentYaml) {
    throw new Error("Pipeline has no saved configuration to modify");
  }
  const parsed = yaml.load(currentYaml) as Record<string, Record<string, unknown>> | null;
  if (!parsed) {
    throw new Error("Pipeline has no saved configuration to modify");
  }

  const sinks = parsed.sinks as Record<string, Record<string, unknown>> | undefined;
  if (!sinks || !sinks[params.targetSinkKey]) {
    throw new Error(`Sink "${params.targetSinkKey}" not found in pipeline config`);
  }

  const sink = sinks[params.targetSinkKey];
  const currentInputs = (sink.inputs as string[]) ?? [];

  const transforms = (parsed.transforms ?? {}) as Record<string, Record<string, unknown>>;
  transforms[params.componentKey] = {
    type: params.type,
    inputs: [...currentInputs],
    ...params.config,
  };
  parsed.transforms = transforms;

  sink.inputs = [params.componentKey];

  return yaml.dump(parsed, { lineWidth: -1, noRefs: true, sortKeys: false });
}

/**
 * Insert a `tail_sample` node by expanding it into its Vector reduce+filter
 * blocks (prepare → collect → keep-decision filter) and rewiring the target sink
 * to read the sampled output. Mirrors how the config-generator expands the
 * editor's `tail_sample` graph node at deploy time, so the preview/stored YAML
 * stays consistent with what would actually run.
 */
function applyTailSample(
  currentYaml: string,
  config: {
    componentKey: string;
    key: string;
    windowMs: number;
    keepPolicies: {
      onError: boolean;
      slowThresholdMs: number | null;
      baselinePercent: number;
    };
  },
  targetSinkKey: string,
): string {
  if (!currentYaml) {
    throw new Error("Pipeline has no saved configuration to modify");
  }
  const parsed = yaml.load(currentYaml) as Record<string, Record<string, unknown>> | null;
  if (!parsed) {
    throw new Error("Pipeline has no saved configuration to modify");
  }

  const sinks = parsed.sinks as Record<string, Record<string, unknown>> | undefined;
  if (!sinks || !sinks[targetSinkKey]) {
    throw new Error(`Sink "${targetSinkKey}" not found in pipeline config`);
  }

  const sink = sinks[targetSinkKey];
  const currentInputs = (sink.inputs as string[]) ?? [];

  const blocks = renderTailSampleBlocks(config.componentKey, config, currentInputs);
  const transforms = (parsed.transforms ?? {}) as Record<string, Record<string, unknown>>;
  for (const [key, block] of Object.entries(blocks)) {
    transforms[key] = block;
  }
  parsed.transforms = transforms;

  // The terminal filter reuses componentKey, so the sink reads the sampled output.
  sink.inputs = [config.componentKey];

  return yaml.dump(parsed, { lineWidth: -1, noRefs: true, sortKeys: false });
}
