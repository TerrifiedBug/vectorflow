// src/server/services/dlp-templates/types.ts
export interface DlpTemplateParam {
  readonly name: string;
  readonly label: string;
  readonly type: "string" | "string[]" | "boolean";
  readonly description: string;
  readonly default: string | string[] | boolean;
}

export interface DlpTestFixture {
  readonly description: string;
  readonly input: Record<string, unknown>;
  readonly expectedOutput: Record<string, unknown>;
}

export interface DlpTemplateDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: "Data Protection";
  readonly complianceTags: readonly string[];
  readonly params: readonly DlpTemplateParam[];
  readonly vrlSource: string;
  readonly testFixtures: readonly DlpTestFixture[];
}
