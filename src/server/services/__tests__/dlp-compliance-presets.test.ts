// src/server/services/__tests__/dlp-compliance-presets.test.ts
import { describe, it, expect } from "vitest";
import { ALL_DLP_TEMPLATES } from "../dlp-templates";
import {
  getCompliancePresets,
  getPresetTemplates,
  type ComplianceFramework,
} from "../dlp-templates/compliance-presets";

const VALID_IDS = new Set(ALL_DLP_TEMPLATES.map((t) => t.id));

describe("DLP compliance presets", () => {
  it("exposes one preset per supported framework", () => {
    const presets = getCompliancePresets();
    expect(presets.map((p) => p.framework)).toEqual(["PCI-DSS", "HIPAA", "GDPR"]);
  });

  it("bundles exactly the templates tagged for each framework", () => {
    const byFramework = new Map(getCompliancePresets().map((p) => [p.framework, p.templateIds]));
    // PCI-DSS: credit-card, api-key, json-field
    expect(byFramework.get("PCI-DSS")).toEqual([
      "dlp-credit-card-masking",
      "dlp-api-key-redaction",
      "dlp-json-field-removal",
    ]);
    // HIPAA: ssn, email, phone, json-field
    expect(byFramework.get("HIPAA")).toHaveLength(4);
    // GDPR: ssn, email, ip, phone, api-key, json-field
    expect(byFramework.get("GDPR")).toHaveLength(6);
  });

  it("only references real template ids and never the untagged custom-regex template", () => {
    for (const preset of getCompliancePresets()) {
      expect(preset.templateIds.length).toBeGreaterThan(0);
      for (const id of preset.templateIds) {
        expect(VALID_IDS.has(id)).toBe(true);
      }
      expect(preset.templateIds).not.toContain("dlp-custom-regex-masking");
    }
  });

  it("getPresetTemplates returns full definitions all tagged for the framework", () => {
    for (const framework of ["PCI-DSS", "HIPAA", "GDPR"] as ComplianceFramework[]) {
      const templates = getPresetTemplates(framework);
      expect(templates.length).toBeGreaterThan(0);
      for (const t of templates) {
        expect(t.complianceTags).toContain(framework);
      }
    }
  });

  it("stays consistent with the source templates (derived, not hand-maintained)", () => {
    const gdpr = getPresetTemplates("GDPR").map((t) => t.id);
    const expected = ALL_DLP_TEMPLATES.filter((t) => t.complianceTags.includes("GDPR")).map(
      (t) => t.id,
    );
    expect(gdpr).toEqual(expected);
  });
});
