import type { VectorComponentDef } from "../../types";
import { localSources } from "./local";
import { networkSources } from "./network";
import { messagingSources } from "./messaging";
import { metricSources } from "./metrics";
import { containerSources } from "./container";

export const ALL_SOURCES: VectorComponentDef[] = [
  ...localSources,
  ...networkSources,
  ...messagingSources,
  ...metricSources,
  ...containerSources,
];
