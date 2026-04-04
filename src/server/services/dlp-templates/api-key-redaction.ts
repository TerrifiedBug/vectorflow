// src/server/services/dlp-templates/api-key-redaction.ts
import type { DlpTemplateDefinition } from "./types";

export const API_KEY_REDACTION: DlpTemplateDefinition = {
  id: "dlp-api-key-redaction",
  name: "API Key / Token Redaction",
  description:
    "Detect and redact common API key, bearer token, and secret patterns from log messages. Covers: Bearer tokens, sk-/pk- prefixed keys, api_key= parameters, AWS access keys, GitHub tokens (ghp_/gho_/ghs_).",
  category: "Data Protection",
  complianceTags: ["PCI-DSS", "GDPR"],
  params: [
    {
      name: "fields",
      label: "Fields to scan",
      type: "string[]",
      description: "Dot-path fields to scan for API keys and tokens",
      default: [".message"],
    },
    {
      name: "replacement",
      label: "Replacement text",
      type: "string",
      description: "Text to replace detected keys/tokens with",
      default: "[REDACTED-KEY]",
    },
  ],
  vrlSource: `# API Key / Token Redaction (PCI-DSS / GDPR)
# Detects common secret patterns and replaces with placeholder

fields = ["message"]
replacement = "[REDACTED-KEY]"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    # Bearer tokens: "Bearer <token>" (20+ chars)
    val = replace(val, r'Bearer\\s+[A-Za-z0-9\\-._~+/]+=*', "Bearer " + replacement)

    # OpenAI-style keys: sk-proj-xxx, sk-xxx (20+ chars)
    val = replace(val, r'\\bsk-(?:proj-)?[A-Za-z0-9]{20,}\\b', replacement)

    # Stripe-style keys: pk_live_xxx, sk_live_xxx, pk_test_xxx, sk_test_xxx
    val = replace(val, r'\\b[sp]k_(?:live|test)_[A-Za-z0-9]{20,}\\b', replacement)

    # AWS access key IDs: AKIA followed by 16 uppercase alphanum
    val = replace(val, r'\\bAKIA[A-Z0-9]{16}\\b', replacement)

    # AWS secret keys: 40-char base64 after common key labels (quotes removed to avoid VRL raw string conflict)
    val = replace(val, r'(?i)(?:aws_secret_access_key|secret_key|aws_secret)[=: ]+[A-Za-z0-9/+=]{40}', replacement)

    # GitHub tokens: ghp_, gho_, ghs_, ghr_ followed by 36+ alphanum
    val = replace(val, r'\\bgh[posr]_[A-Za-z0-9]{36,}\\b', replacement)

    # Generic api_key=, apikey=, api-key= query params or config values
    val = replace(val, r'(?i)(?:api[_-]?key|apikey|api[_-]?secret)[=: ]+[A-Za-z0-9\\-._~]{16,}', replacement)

    . = set!(., [field_path], val)
  }
}
`,
  testFixtures: [
    {
      description: "Redacts a Bearer token",
      input: {
        message: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      },
      expectedOutput: {
        message: "Authorization: Bearer [REDACTED-KEY]",
      },
    },
    {
      description: "Redacts an OpenAI key",
      input: {
        message: "Using key sk-proj-abc123def456ghi789jkl012mno345pqr678",
      },
      expectedOutput: {
        message: "Using key [REDACTED-KEY]",
      },
    },
    {
      description: "Redacts an AWS access key",
      input: {
        message: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
      },
      expectedOutput: {
        message: "AWS_ACCESS_KEY_ID=[REDACTED-KEY]",
      },
    },
    {
      description: "Redacts a GitHub personal access token",
      input: {
        message: "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn",
      },
      expectedOutput: {
        message: "token: [REDACTED-KEY]",
      },
    },
    {
      description: "Preserves normal text without keys",
      input: {
        message: "Deployment successful to production",
      },
      expectedOutput: {
        message: "Deployment successful to production",
      },
    },
  ],
};
