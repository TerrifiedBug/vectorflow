// src/server/services/dlp-templates/compliance-presets.ts
import { ALL_DLP_TEMPLATES } from "./index";
import type { DlpTemplateDefinition } from "./types";

/**
 * Compliance frameworks a DLP preset can target. Matches the `complianceTags`
 * vocabulary carried by each {@link DlpTemplateDefinition}.
 */
export type ComplianceFramework = "PCI-DSS" | "HIPAA" | "GDPR";

export interface CompliancePreset {
  readonly framework: ComplianceFramework;
  readonly name: string;
  readonly description: string;
  /** IDs of the DLP templates this preset bundles (every template tagged for the framework). */
  readonly templateIds: readonly string[];
}

/** Static, human-facing metadata per framework. Ordering here is the display order. */
const PRESET_META: Record<ComplianceFramework, { name: string; description: string }> = {
  "PCI-DSS": {
    name: "PCI-DSS",
    description: "Mask cardholder data and secrets before they leave your network (payment-card compliance).",
  },
  HIPAA: {
    name: "HIPAA",
    description: "Redact protected health information (PHI) such as SSNs, names, and contact details (healthcare compliance).",
  },
  GDPR: {
    name: "GDPR",
    description: "Anonymize personal data (PII) including IPs, emails, and phone numbers (EU data-protection compliance).",
  },
};

const FRAMEWORKS = Object.keys(PRESET_META) as ComplianceFramework[];

/**
 * Compliance presets derived from each template's `complianceTags`. A preset
 * bundles every DLP template relevant to one framework so an operator can apply
 * the whole set to a pipeline in one step instead of hand-picking templates.
 *
 * Derived (not hand-maintained) so adding/removing a template's tag keeps the
 * presets correct automatically.
 */
export function getCompliancePresets(): readonly CompliancePreset[] {
  return FRAMEWORKS.map((framework) => ({
    framework,
    name: PRESET_META[framework].name,
    description: PRESET_META[framework].description,
    templateIds: ALL_DLP_TEMPLATES.filter((t) => t.complianceTags.includes(framework)).map(
      (t) => t.id,
    ),
  }));
}

/** Resolve the full DLP template definitions bundled by a compliance framework. */
export function getPresetTemplates(
  framework: ComplianceFramework,
): readonly DlpTemplateDefinition[] {
  return ALL_DLP_TEMPLATES.filter((t) => t.complianceTags.includes(framework));
}
