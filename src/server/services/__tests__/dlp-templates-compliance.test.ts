// src/server/services/__tests__/dlp-templates-compliance.test.ts
import { describe, it, expect } from "vitest";
import { ALL_DLP_TEMPLATES } from "../dlp-templates";

describe("DLP template compliance tags", () => {
  it("all 8 templates have a complianceTags array", () => {
    expect(ALL_DLP_TEMPLATES).toHaveLength(8);
    for (const template of ALL_DLP_TEMPLATES) {
      expect(Array.isArray(template.complianceTags)).toBe(true);
    }
  });

  it("credit card masking has PCI-DSS tag", () => {
    const ccTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-credit-card-masking"
    );
    expect(ccTemplate?.complianceTags).toContain("PCI-DSS");
  });

  it("SSN masking has HIPAA and GDPR tags", () => {
    const ssnTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-ssn-masking"
    );
    expect(ssnTemplate?.complianceTags).toContain("HIPAA");
    expect(ssnTemplate?.complianceTags).toContain("GDPR");
  });

  it("email redaction has GDPR and HIPAA tags", () => {
    const emailTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-email-redaction"
    );
    expect(emailTemplate?.complianceTags).toContain("GDPR");
    expect(emailTemplate?.complianceTags).toContain("HIPAA");
  });

  it("IP anonymization has GDPR tag", () => {
    const ipTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-ip-anonymization"
    );
    expect(ipTemplate?.complianceTags).toContain("GDPR");
  });

  it("phone masking has GDPR and HIPAA tags", () => {
    const phoneTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-phone-masking"
    );
    expect(phoneTemplate?.complianceTags).toContain("GDPR");
    expect(phoneTemplate?.complianceTags).toContain("HIPAA");
  });

  it("API key redaction has PCI-DSS and GDPR tags", () => {
    const apiTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-api-key-redaction"
    );
    expect(apiTemplate?.complianceTags).toContain("PCI-DSS");
    expect(apiTemplate?.complianceTags).toContain("GDPR");
  });

  it("custom regex masking has no compliance tags", () => {
    const customTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-custom-regex-masking"
    );
    expect(customTemplate?.complianceTags).toHaveLength(0);
  });

  it("JSON field removal has GDPR, HIPAA, and PCI-DSS tags", () => {
    const jsonTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-json-field-removal"
    );
    expect(jsonTemplate?.complianceTags).toContain("GDPR");
    expect(jsonTemplate?.complianceTags).toContain("HIPAA");
    expect(jsonTemplate?.complianceTags).toContain("PCI-DSS");
  });

  it("only uses allowed compliance tag values", () => {
    const ALLOWED_TAGS = ["PCI-DSS", "HIPAA", "GDPR"];
    for (const template of ALL_DLP_TEMPLATES) {
      for (const tag of template.complianceTags) {
        expect(ALLOWED_TAGS).toContain(tag);
      }
    }
  });
});
