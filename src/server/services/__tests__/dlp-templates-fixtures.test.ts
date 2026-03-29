// src/server/services/__tests__/dlp-templates-fixtures.test.ts
import { describe, it, expect } from "vitest";
import { ALL_DLP_TEMPLATES } from "../dlp-templates";

describe("DLP template test fixtures", () => {
  it("every template has at least 1 test fixture", () => {
    for (const template of ALL_DLP_TEMPLATES) {
      expect(template.testFixtures.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every fixture has description, input, and expectedOutput", () => {
    for (const template of ALL_DLP_TEMPLATES) {
      for (const fixture of template.testFixtures) {
        expect(fixture.description).toBeTruthy();
        expect(fixture.input).toBeDefined();
        expect(fixture.expectedOutput).toBeDefined();
        expect(typeof fixture.input).toBe("object");
        expect(typeof fixture.expectedOutput).toBe("object");
      }
    }
  });

  it("fixture inputs and outputs are valid JSON objects (not null)", () => {
    for (const template of ALL_DLP_TEMPLATES) {
      for (const fixture of template.testFixtures) {
        expect(fixture.input).not.toBeNull();
        expect(fixture.expectedOutput).not.toBeNull();
      }
    }
  });

  it("credit card masking has at least 3 fixtures", () => {
    const ccTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-credit-card-masking"
    );
    expect(ccTemplate?.testFixtures.length).toBeGreaterThanOrEqual(3);
  });

  it("SSN masking has at least 3 fixtures", () => {
    const ssnTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-ssn-masking"
    );
    expect(ssnTemplate?.testFixtures.length).toBeGreaterThanOrEqual(3);
  });

  it("email redaction has at least 3 fixtures", () => {
    const emailTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-email-redaction"
    );
    expect(emailTemplate?.testFixtures.length).toBeGreaterThanOrEqual(3);
  });

  it("IP anonymization has at least 3 fixtures", () => {
    const ipTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-ip-anonymization"
    );
    expect(ipTemplate?.testFixtures.length).toBeGreaterThanOrEqual(3);
  });

  it("phone masking has at least 3 fixtures", () => {
    const phoneTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-phone-masking"
    );
    expect(phoneTemplate?.testFixtures.length).toBeGreaterThanOrEqual(3);
  });

  it("API key redaction has at least 5 fixtures", () => {
    const apiTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-api-key-redaction"
    );
    expect(apiTemplate?.testFixtures.length).toBeGreaterThanOrEqual(5);
  });

  it("JSON field removal has at least 3 fixtures", () => {
    const jsonTemplate = ALL_DLP_TEMPLATES.find(
      (t) => t.id === "dlp-json-field-removal"
    );
    expect(jsonTemplate?.testFixtures.length).toBeGreaterThanOrEqual(3);
  });

  it("every template has at least one negative test (no match expected)", () => {
    // Templates that should have negative tests (where input passes through unchanged)
    const templatesWithNegativeTests = [
      "dlp-credit-card-masking",
      "dlp-ssn-masking",
      "dlp-email-redaction",
      "dlp-ip-anonymization",
      "dlp-phone-masking",
      "dlp-api-key-redaction",
      "dlp-json-field-removal",
    ];

    for (const templateId of templatesWithNegativeTests) {
      const template = ALL_DLP_TEMPLATES.find((t) => t.id === templateId);
      expect(template).toBeDefined();

      const hasNegativeTest = template!.testFixtures.some(
        (f) => JSON.stringify(f.input) === JSON.stringify(f.expectedOutput) ||
          f.description.toLowerCase().includes("preserv") ||
          f.description.toLowerCase().includes("does not match") ||
          f.description.toLowerCase().includes("handles missing")
      );

      expect(hasNegativeTest).toBe(true);
    }
  });
});
