export type DataType = "log" | "metric" | "trace";

export interface VectorComponentDef {
  type: string;
  kind: "source" | "transform" | "sink";
  displayName: string;
  description: string;
  category: string;
  status?: "stable" | "beta" | "deprecated";
  inputTypes?: DataType[];
  outputTypes: DataType[];
  configSchema: object;
  icon?: string;
}
