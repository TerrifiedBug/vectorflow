// src/server/services/dlp-templates/phone-masking.ts
import type { DlpTemplateDefinition } from "./types";

export const PHONE_MASKING: DlpTemplateDefinition = {
  id: "dlp-phone-masking",
  name: "Phone Number Masking",
  description:
    "Detect and mask US/international phone number patterns. Supports formats: +1 (555) 123-4567, 555-123-4567, 5551234567, +44 20 7946 0958.",
  category: "Data Protection",
  complianceTags: ["GDPR", "HIPAA"],
  params: [
    {
      name: "fields",
      label: "Fields to scan",
      type: "string[]",
      description: "Dot-path fields to scan for phone numbers",
      default: [".message"],
    },
    {
      name: "replacement",
      label: "Replacement text",
      type: "string",
      description: "Text to replace phone numbers with",
      default: "[REDACTED-PHONE]",
    },
  ],
  vrlSource: `# Phone Number Masking (GDPR / HIPAA)
# Detects US and international phone formats
# +1 (555) 123-4567, 555-123-4567, (555) 123 4567, +44 20 7946 0958

fields = ["message"]
replacement = "[REDACTED-PHONE]"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    # International format: +country_code (area) exchange number
    val = replace(val, r'\\+[1-9][0-9]{0,2}[- ]?\\(?[0-9]{1,4}\\)?[- ]?[0-9]{1,4}[- ]?[0-9]{4}', replacement)

    # US format: (XXX) XXX-XXXX or XXX-XXX-XXXX or XXX.XXX.XXXX
    val = replace(val, r'\\(?[0-9]{3}\\)?[- .]?[0-9]{3}[- .]?[0-9]{4}\\b', replacement)

    . = set!(., [field_path], val)
  }
}
`,
  testFixtures: [
    {
      description: "Masks a US phone with country code",
      input: {
        message: "Contact: +1 (555) 123-4567 for support",
      },
      expectedOutput: {
        message: "Contact: [REDACTED-PHONE] for support",
      },
    },
    {
      description: "Masks a US phone without country code",
      input: {
        message: "Called 555-867-5309 yesterday",
      },
      expectedOutput: {
        message: "Called [REDACTED-PHONE] yesterday",
      },
    },
    {
      description: "Preserves short numeric sequences",
      input: {
        message: "Error code: 12345",
      },
      expectedOutput: {
        message: "Error code: 12345",
      },
    },
  ],
};
