// src/server/services/dlp-templates/json-field-removal.ts
import type { DlpTemplateDefinition } from "./types";

export const JSON_FIELD_REMOVAL: DlpTemplateDefinition = {
  id: "dlp-json-field-removal",
  name: "JSON Field Removal",
  description:
    "Drop specified fields from structured log events. Use to remove sensitive fields like passwords, tokens, personal data, or internal metadata before forwarding to sinks.",
  category: "Data Protection",
  complianceTags: ["GDPR", "HIPAA", "PCI-DSS"],
  params: [
    {
      name: "remove_fields",
      label: "Fields to remove",
      type: "string[]",
      description: "Dot-path fields to delete from events (e.g., .password, .user.ssn, .metadata.internal_id)",
      default: [".password", ".secret", ".token"],
    },
  ],
  vrlSource: `# JSON Field Removal (GDPR / HIPAA / PCI-DSS)
# Drops specified fields from structured log events
# Fields that don't exist are silently skipped

remove_fields = ["password", "secret", "token"]

for_each(remove_fields) -> |_idx, field_path| {
  . = remove!(., [field_path], compact: false)
}
`,
  testFixtures: [
    {
      description: "Removes password and token fields",
      input: {
        message: "User login",
        user: "john",
        password: "s3cret!",
        token: "abc123xyz",
        timestamp: "2026-01-15T10:30:00Z",
      },
      expectedOutput: {
        message: "User login",
        user: "john",
        timestamp: "2026-01-15T10:30:00Z",
      },
    },
    {
      description: "Handles missing fields gracefully",
      input: {
        message: "Health check",
        status: "ok",
      },
      expectedOutput: {
        message: "Health check",
        status: "ok",
      },
    },
    {
      description: "Removes nested sensitive fields",
      input: {
        message: "API call",
        secret: "vault-token-xxx",
        metadata: { requestId: "req-001" },
      },
      expectedOutput: {
        message: "API call",
        metadata: { requestId: "req-001" },
      },
    },
  ],
};
