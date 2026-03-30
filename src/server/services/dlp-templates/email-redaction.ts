// src/server/services/dlp-templates/email-redaction.ts
import type { DlpTemplateDefinition } from "./types";

export const EMAIL_REDACTION: DlpTemplateDefinition = {
  id: "dlp-email-redaction",
  name: "Email Redaction",
  description:
    "Detect and replace email addresses with [REDACTED-EMAIL] in log messages. Supports standard RFC 5322 email patterns.",
  category: "Data Protection",
  complianceTags: ["GDPR", "HIPAA"],
  params: [
    {
      name: "fields",
      label: "Fields to scan",
      type: "string[]",
      description: "Dot-path fields to scan for email addresses",
      default: [".message"],
    },
    {
      name: "replacement",
      label: "Replacement text",
      type: "string",
      description: "Text to replace email addresses with",
      default: "[REDACTED-EMAIL]",
    },
  ],
  vrlSource: `# Email Redaction (GDPR / HIPAA)
# Detects standard email patterns per RFC 5322 simplified

fields = [.message]
replacement = "[REDACTED-EMAIL]"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    # Email pattern: local-part@domain.tld
    # local-part: alphanumeric, dots, hyphens, underscores, plus signs
    # domain: alphanumeric with dots and hyphens, 2+ char TLD
    val = replace(val, r'\\b[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}\\b', replacement)

    . = set!(., [field_path], val)
  }
}
`,
  testFixtures: [
    {
      description: "Redacts a standard email address",
      input: {
        message: "User john.doe@example.com logged in",
      },
      expectedOutput: {
        message: "User [REDACTED-EMAIL] logged in",
      },
    },
    {
      description: "Redacts multiple email addresses",
      input: {
        message: "From: admin@corp.io To: user+tag@sub.domain.org",
      },
      expectedOutput: {
        message: "From: [REDACTED-EMAIL] To: [REDACTED-EMAIL]",
      },
    },
    {
      description: "Preserves non-email @ references",
      input: {
        message: "Price is $5 @ 10 units",
      },
      expectedOutput: {
        message: "Price is $5 @ 10 units",
      },
    },
  ],
};
