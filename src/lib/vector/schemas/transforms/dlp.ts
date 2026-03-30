// src/lib/vector/schemas/transforms/dlp.ts
import type { VectorComponentDef } from "../../types";

export const DLP_TRANSFORMS: VectorComponentDef[] = [
  {
    type: "dlp_credit_card_masking",
    kind: "transform",
    displayName: "Credit Card Masking",
    description: "Mask credit card numbers (Visa, MC, Amex, Discover) — PCI DSS compliant",
    category: "Data Protection",
    icon: "CreditCard",
    inputTypes: ["log"],
    outputTypes: ["log"],
    configSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "VRL program (pre-filled with credit card masking logic)",
          "x-dlp-template": "dlp-credit-card-masking",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          default: [".message"],
          description: "Dot-path fields to scan for credit card numbers",
        },
        mask_char: {
          type: "string",
          default: "*",
          description: "Character used to replace digits",
        },
        drop_on_error: {
          type: "boolean",
          default: false,
          description: "Drop events that cause a runtime error",
        },
        drop_on_abort: {
          type: "boolean",
          default: true,
          description: "Drop events that trigger an abort",
        },
      },
      required: ["source"],
    },
  },
  {
    type: "dlp_ssn_masking",
    kind: "transform",
    displayName: "SSN Masking",
    description: "Mask US Social Security Numbers (XXX-XX-XXXX) — HIPAA/GDPR",
    category: "Data Protection",
    icon: "ShieldAlert",
    inputTypes: ["log"],
    outputTypes: ["log"],
    configSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "VRL program (pre-filled with SSN masking logic)",
          "x-dlp-template": "dlp-ssn-masking",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          default: [".message"],
          description: "Dot-path fields to scan for SSN patterns",
        },
        full_redact: {
          type: "boolean",
          default: false,
          description: "Replace entire SSN with [REDACTED-SSN] instead of partial mask",
        },
        drop_on_error: {
          type: "boolean",
          default: false,
        },
        drop_on_abort: {
          type: "boolean",
          default: true,
        },
      },
      required: ["source"],
    },
  },
  {
    type: "dlp_email_redaction",
    kind: "transform",
    displayName: "Email Redaction",
    description: "Replace email addresses with [REDACTED-EMAIL] — GDPR/HIPAA",
    category: "Data Protection",
    icon: "MailX",
    inputTypes: ["log"],
    outputTypes: ["log"],
    configSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "VRL program (pre-filled with email redaction logic)",
          "x-dlp-template": "dlp-email-redaction",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          default: [".message"],
          description: "Dot-path fields to scan for email addresses",
        },
        replacement: {
          type: "string",
          default: "[REDACTED-EMAIL]",
          description: "Text to replace email addresses with",
        },
        drop_on_error: {
          type: "boolean",
          default: false,
        },
        drop_on_abort: {
          type: "boolean",
          default: true,
        },
      },
      required: ["source"],
    },
  },
  {
    type: "dlp_ip_anonymization",
    kind: "transform",
    displayName: "IP Anonymization",
    description: "Zero last octet of IPv4 addresses for anonymization — GDPR",
    category: "Data Protection",
    icon: "Globe",
    inputTypes: ["log"],
    outputTypes: ["log"],
    configSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "VRL program (pre-filled with IP anonymization logic)",
          "x-dlp-template": "dlp-ip-anonymization",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          default: [".message"],
          description: "Dot-path fields to scan for IP addresses",
        },
        replace_octet: {
          type: "string",
          default: "0",
          description: "Value to replace the last octet with",
        },
        drop_on_error: {
          type: "boolean",
          default: false,
        },
        drop_on_abort: {
          type: "boolean",
          default: true,
        },
      },
      required: ["source"],
    },
  },
  {
    type: "dlp_phone_masking",
    kind: "transform",
    displayName: "Phone Number Masking",
    description: "Mask US/international phone numbers — GDPR/HIPAA",
    category: "Data Protection",
    icon: "PhoneOff",
    inputTypes: ["log"],
    outputTypes: ["log"],
    configSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "VRL program (pre-filled with phone masking logic)",
          "x-dlp-template": "dlp-phone-masking",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          default: [".message"],
          description: "Dot-path fields to scan for phone numbers",
        },
        replacement: {
          type: "string",
          default: "[REDACTED-PHONE]",
          description: "Text to replace phone numbers with",
        },
        drop_on_error: {
          type: "boolean",
          default: false,
        },
        drop_on_abort: {
          type: "boolean",
          default: true,
        },
      },
      required: ["source"],
    },
  },
  {
    type: "dlp_api_key_redaction",
    kind: "transform",
    displayName: "API Key Redaction",
    description: "Redact API keys, bearer tokens, and secrets — PCI-DSS/GDPR",
    category: "Data Protection",
    icon: "KeyRound",
    inputTypes: ["log"],
    outputTypes: ["log"],
    configSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "VRL program (pre-filled with API key redaction logic)",
          "x-dlp-template": "dlp-api-key-redaction",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          default: [".message"],
          description: "Dot-path fields to scan for API keys and tokens",
        },
        replacement: {
          type: "string",
          default: "[REDACTED-KEY]",
          description: "Text to replace detected keys/tokens with",
        },
        drop_on_error: {
          type: "boolean",
          default: false,
        },
        drop_on_abort: {
          type: "boolean",
          default: true,
        },
      },
      required: ["source"],
    },
  },
  {
    type: "dlp_custom_regex_masking",
    kind: "transform",
    displayName: "Custom Regex Masking",
    description: "User-defined regex pattern for masking custom sensitive data",
    category: "Data Protection",
    icon: "Regex",
    inputTypes: ["log"],
    outputTypes: ["log"],
    configSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "VRL program (pre-filled with custom regex masking logic)",
          "x-dlp-template": "dlp-custom-regex-masking",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          default: [".message"],
          description: "Dot-path fields to apply the regex to",
        },
        pattern: {
          type: "string",
          default: "CHANGE_ME",
          description: "Regex pattern to match (Rust regex syntax)",
        },
        replacement: {
          type: "string",
          default: "[REDACTED]",
          description: "Text to replace matched patterns with",
        },
        drop_on_error: {
          type: "boolean",
          default: false,
        },
        drop_on_abort: {
          type: "boolean",
          default: true,
        },
      },
      required: ["source", "pattern"],
    },
  },
  {
    type: "dlp_json_field_removal",
    kind: "transform",
    displayName: "JSON Field Removal",
    description: "Drop sensitive fields from structured logs — GDPR/HIPAA/PCI-DSS",
    category: "Data Protection",
    icon: "Eraser",
    inputTypes: ["log"],
    outputTypes: ["log"],
    configSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "VRL program (pre-filled with field removal logic)",
          "x-dlp-template": "dlp-json-field-removal",
        },
        remove_fields: {
          type: "array",
          items: { type: "string" },
          default: [".password", ".secret", ".token"],
          description: "Dot-path fields to delete from events",
        },
        drop_on_error: {
          type: "boolean",
          default: false,
        },
        drop_on_abort: {
          type: "boolean",
          default: true,
        },
      },
      required: ["source"],
    },
  },
];
