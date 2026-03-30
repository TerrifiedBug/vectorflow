// src/server/services/dlp-templates/ip-anonymization.ts
import type { DlpTemplateDefinition } from "./types";

export const IP_ANONYMIZATION: DlpTemplateDefinition = {
  id: "dlp-ip-anonymization",
  name: "IP Anonymization",
  description:
    "Anonymize IPv4 addresses by zeroing the last octet (e.g., 192.168.1.42 becomes 192.168.1.0). Compliant with GDPR IP address anonymization requirements.",
  category: "Data Protection",
  complianceTags: ["GDPR"],
  params: [
    {
      name: "fields",
      label: "Fields to scan",
      type: "string[]",
      description: "Dot-path fields to scan for IP addresses",
      default: [".message"],
    },
    {
      name: "replace_octet",
      label: "Replacement octet",
      type: "string",
      description: "Value to replace the last octet with",
      default: "0",
    },
  ],
  vrlSource: `# IP Anonymization (GDPR)
# Zeros the last octet of IPv4 addresses
# 192.168.1.42 -> 192.168.1.0

fields = [.message]
replace_octet = "0"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    # IPv4 pattern: 1-3 digits . 1-3 digits . 1-3 digits . 1-3 digits
    # Word boundaries prevent matching version numbers like 1.2.3.4.5
    val = replace(val, r'\\b((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.)(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b', "\${1}" + replace_octet)

    . = set!(., [field_path], val)
  }
}
`,
  testFixtures: [
    {
      description: "Anonymizes a standard IPv4 address",
      input: {
        message: "Connection from 192.168.1.42 on port 443",
      },
      expectedOutput: {
        message: "Connection from 192.168.1.0 on port 443",
      },
    },
    {
      description: "Anonymizes multiple IP addresses",
      input: {
        message: "src=10.0.0.15 dst=172.16.254.99",
      },
      expectedOutput: {
        message: "src=10.0.0.0 dst=172.16.254.0",
      },
    },
    {
      description: "Preserves non-IP numeric patterns",
      input: {
        message: "Version 2.3.1 released",
      },
      expectedOutput: {
        message: "Version 2.3.1 released",
      },
    },
  ],
};
