// src/server/services/dlp-templates/ssn-masking.ts
import type { DlpTemplateDefinition } from "./types";

export const SSN_MASKING: DlpTemplateDefinition = {
  id: "dlp-ssn-masking",
  name: "SSN Masking",
  description:
    "Detect and mask US Social Security Numbers (XXX-XX-XXXX pattern) in log messages. Replaces with ***-**-XXXX preserving last 4 digits.",
  category: "Data Protection",
  complianceTags: ["HIPAA", "GDPR"],
  params: [
    {
      name: "fields",
      label: "Fields to scan",
      type: "string[]",
      description: "Dot-path fields to scan for SSN patterns",
      default: [".message"],
    },
    {
      name: "full_redact",
      label: "Full redaction",
      type: "boolean",
      description: "When true, replaces entire SSN with [REDACTED-SSN] instead of partial mask",
      default: false,
    },
  ],
  vrlSource: `# SSN Masking (HIPAA / GDPR)
# Detects XXX-XX-XXXX, XXX XX XXXX, and XXXXXXXXX patterns
# Avoids false positives by excluding 000, 666, 900-999 area numbers per SSA rules

fields = [.message]
full_redact = false

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    # SSN pattern: area (001-899 excl 666), group (01-99), serial (0001-9999)
    val = replace(val, r'\\b(?!000|666|9[0-9]{2})[0-9]{3}[- ]?(?!00)[0-9]{2}[- ]?(?!0000)[0-9]{4}\\b', |match| {
      if full_redact {
        "[REDACTED-SSN]"
      } else {
        digits = replace(match, r'[^0-9]', "")
        last4 = slice!(digits, 5)
        "***-**-" + last4
      }
    })

    . = set!(., [field_path], val)
  }
}
`,
  testFixtures: [
    {
      description: "Masks a standard SSN with dashes",
      input: {
        message: "Patient SSN: 123-45-6789 in record",
      },
      expectedOutput: {
        message: "Patient SSN: ***-**-6789 in record",
      },
    },
    {
      description: "Masks SSN without separators",
      input: {
        message: "SSN=123456789",
      },
      expectedOutput: {
        message: "SSN=***-**-6789",
      },
    },
    {
      description: "Does not match invalid SSN (area 000)",
      input: {
        message: "ID: 000-12-3456",
      },
      expectedOutput: {
        message: "ID: 000-12-3456",
      },
    },
  ],
};
