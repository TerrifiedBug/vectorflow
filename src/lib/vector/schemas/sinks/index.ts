import type { VectorComponentDef } from "../../types";
import { awsSinks } from "./aws";
import { gcpSinks } from "./gcp";
import { azureSinks } from "./azure";
import { datadogSinks } from "./datadog";
import { observabilitySinks } from "./observability";
import { searchDbSinks } from "./search-db";
import { loggingSinks } from "./logging";
import { messagingSinks } from "./messaging";
import { metricsSinks } from "./metrics";
import { networkSinks } from "./network";

export const ALL_SINKS: VectorComponentDef[] = [
  ...awsSinks,
  ...gcpSinks,
  ...azureSinks,
  ...datadogSinks,
  ...observabilitySinks,
  ...searchDbSinks,
  ...loggingSinks,
  ...messagingSinks,
  ...metricsSinks,
  ...networkSinks,
];
