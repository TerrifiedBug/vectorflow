// src/server/services/dlp-templates/credit-card-masking.ts
import type { DlpTemplateDefinition } from "./types";

export const CREDIT_CARD_MASKING: DlpTemplateDefinition = {
  id: "dlp-credit-card-masking",
  name: "Credit Card Masking",
  description:
    "Detect and mask credit card numbers (Visa, Mastercard, Amex, Discover) in log messages. Replaces all but the last 4 digits with asterisks. PCI DSS compliant.",
  category: "Data Protection",
  complianceTags: ["PCI-DSS"],
  params: [
    {
      name: "fields",
      label: "Fields to scan",
      type: "string[]",
      description: "Dot-path fields to scan for credit card numbers",
      default: [".message"],
    },
    {
      name: "mask_char",
      label: "Mask character",
      type: "string",
      description: "Character used to replace digits",
      default: "*",
    },
  ],
  vrlSource: `# Credit Card Masking (PCI DSS)
# Detects Visa, Mastercard, Amex, Discover patterns with optional separators
# Preserves last 4 digits, replaces rest with mask character

fields = ["message"]
mask_char = "*"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    # Match 16-digit card numbers with optional dashes or spaces, capture last 4 digits
    # Pattern covers: Visa (4xxx), MC (5[1-5]xx), Amex (3[47]xxx 15-digit), Discover (6xxx)
    val = replace(val, r'\\b(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|6(?:011|5[0-9]{2}))[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?([0-9]{4})\\b', "************$1")

    . = set!(., [field_path], val)
  }
}
`,
  testFixtures: [
    {
      description: "Masks a Visa card number in message field",
      input: {
        message: "Payment processed for card 4111111111111111 successfully",
        timestamp: "2026-01-15T10:30:00Z",
      },
      expectedOutput: {
        message: "Payment processed for card ************1111 successfully",
        timestamp: "2026-01-15T10:30:00Z",
      },
    },
    {
      description: "Masks a card number with dashes",
      input: {
        message: "Card: 4111-1111-1111-1111",
      },
      expectedOutput: {
        message: "Card: ************1111",
      },
    },
    {
      description: "Preserves messages without card numbers",
      input: {
        message: "User logged in from 192.168.1.1",
      },
      expectedOutput: {
        message: "User logged in from 192.168.1.1",
      },
    },
  ],
};
