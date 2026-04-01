import yaml from "js-yaml";
import type { SuggestedAction } from "@/server/services/cost-optimizer-types";

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
    case "disable_pipeline":
      return null;
  }
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
