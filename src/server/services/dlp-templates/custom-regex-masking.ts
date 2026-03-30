// src/server/services/dlp-templates/custom-regex-masking.ts
import type { DlpTemplateDefinition } from "./types";

export const CUSTOM_REGEX_MASKING: DlpTemplateDefinition = {
  id: "dlp-custom-regex-masking",
  name: "Custom Regex Masking",
  description:
    "Apply a user-defined regex pattern to mask sensitive data in log fields. Configure the pattern, replacement text, and target fields.",
  category: "Data Protection",
  complianceTags: [],
  params: [
    {
      name: "fields",
      label: "Fields to scan",
      type: "string[]",
      description: "Dot-path fields to apply the regex to",
      default: [".message"],
    },
    {
      name: "pattern",
      label: "Regex pattern",
      type: "string",
      description: "Regular expression pattern to match sensitive data (Rust regex syntax)",
      default: "CHANGE_ME",
    },
    {
      name: "replacement",
      label: "Replacement text",
      type: "string",
      description: "Text to replace matched patterns with",
      default: "[REDACTED]",
    },
  ],
  vrlSource: `# Custom Regex Masking
# User-defined regex pattern applied to specified fields
# Configure pattern and replacement to match your data

fields = [.message]
pattern = "CHANGE_ME"
replacement = "[REDACTED]"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    val = replace(val, r'\${pattern}', replacement)

    . = set!(., [field_path], val)
  }
}
`,
  testFixtures: [
    {
      description: "Masks a custom pattern (example: account IDs)",
      input: {
        message: "Account ACCT-12345-XYZ processed",
      },
      expectedOutput: {
        message: "Account [REDACTED] processed",
      },
    },
  ],
};
