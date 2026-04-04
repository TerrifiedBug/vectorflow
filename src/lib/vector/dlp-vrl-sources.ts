// src/lib/vector/dlp-vrl-sources.ts
// Lightweight client-safe map of DLP component types to their default VRL source code.
// This avoids importing server-only code on the client.

export const DLP_VRL_SOURCES: Record<string, string> = {
  dlp_credit_card_masking: `# Credit Card Masking (PCI DSS)
# Detects Visa, Mastercard, Amex, Discover patterns with optional separators
# Preserves last 4 digits, replaces rest with mask character

fields = ["message"]
mask_char = "*"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    mask_prefix_16 = repeat(mask_char, 12)
    mask_prefix_15 = repeat(mask_char, 10)

    # Amex: 3[47]xx-xxxxxx-xxxxx (15 digits, 4-6-5 grouping)
    val = replace(val, r'\\\\b(3[47][0-9]{2})[- ]?([0-9]{6})[- ]?([0-9]{5})\\\\b', repeat(mask_char, 4) + "-" + repeat(mask_char, 6) + "-$3")

    # Visa/MC/Discover: 16 digits (4-4-4-4 grouping)
    val = replace(val, r'\\\\b(?:4[0-9]{3}|5[1-5][0-9]{2}|6(?:011|5[0-9]{2}))[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?([0-9]{4})\\\\b', mask_prefix_16 + "$1")

    . = set!(., [field_path], val)
  }
}
`,

  dlp_ssn_masking: `# SSN Masking (HIPAA / GDPR)
# Detects XXX-XX-XXXX, XXX XX XXXX, and XXXXXXXXX patterns
# Avoids false positives by excluding 000, 666, 900-999 area numbers per SSA rules

fields = ["message"]
full_redact = false

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    # SSN pattern: area (001-665 excl 000/666, 667-899), group (01-99), serial (4 digits)
    # Explicit alternation excludes 000, 666, 900-999 (no lookaheads in VRL 0.54)
    if full_redact {
      val = replace(val, r'\\\\b(0(?:[1-9][0-9]|0[1-9])|[1-5][0-9]{2}|6(?:[0-5][0-9]|6[0-57-9]|[7-9][0-9])|[78][0-9]{2})[- ]?(0[1-9]|[1-9][0-9])[- ]?([0-9]{4})\\\\b', "[REDACTED-SSN]")
    } else {
      val = replace(val, r'\\\\b(0(?:[1-9][0-9]|0[1-9])|[1-5][0-9]{2}|6(?:[0-5][0-9]|6[0-57-9]|[7-9][0-9])|[78][0-9]{2})[- ]?(0[1-9]|[1-9][0-9])[- ]?([0-9]{4})\\\\b', "***-**-$3")
    }

    . = set!(., [field_path], val)
  }
}
`,

  dlp_email_redaction: `# Email Redaction (GDPR / HIPAA)
# Detects standard email patterns per RFC 5322 simplified

fields = ["message"]
replacement = "[REDACTED-EMAIL]"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    val = replace(val, r'\\\\b[a-zA-Z0-9._%+\\\\-]+@[a-zA-Z0-9.\\\\-]+\\\\.[a-zA-Z]{2,}\\\\b', replacement)

    . = set!(., [field_path], val)
  }
}
`,

  dlp_ip_anonymization: `# IP Anonymization (GDPR)
# Zeros the last octet of IPv4 addresses
# 192.168.1.42 -> 192.168.1.0

fields = ["message"]
replace_octet = "0"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    val = replace(val, r'\\\\b((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\\\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\\\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\\\.)(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\\\b', "\${1}" + replace_octet)

    . = set!(., [field_path], val)
  }
}
`,

  dlp_phone_masking: `# Phone Number Masking (GDPR / HIPAA)
# Detects US and international phone formats

fields = ["message"]
replacement = "[REDACTED-PHONE]"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    val = replace(val, r'\\\\+[1-9][0-9]{0,2}[- ]?\\\\(?[0-9]{1,4}\\\\)?[- ]?[0-9]{1,4}[- ]?[0-9]{4}', replacement)
    val = replace(val, r'\\\\(?[0-9]{3}\\\\)?[- .]?[0-9]{3}[- .]?[0-9]{4}\\\\b', replacement)

    . = set!(., [field_path], val)
  }
}
`,

  dlp_api_key_redaction: `# API Key / Token Redaction (PCI-DSS / GDPR)
# Detects common secret patterns and replaces with placeholder

fields = ["message"]
replacement = "[REDACTED-KEY]"

for_each(fields) -> |_idx, field_path| {
  raw_value, err = get(., [field_path])
  if err == null && is_string(raw_value) {
    val = string!(raw_value)

    val = replace(val, r'Bearer\\\\s+[A-Za-z0-9\\\\-._~+/]+=*', "Bearer " + replacement)
    val = replace(val, r'\\\\bsk-(?:proj-)?[A-Za-z0-9]{20,}\\\\b', replacement)
    val = replace(val, r'\\\\b[sp]k_(?:live|test)_[A-Za-z0-9]{20,}\\\\b', replacement)
    val = replace(val, r'\\\\bAKIA[A-Z0-9]{16}\\\\b', replacement)
    val = replace(val, r'(?i)(?:aws_secret_access_key|secret_key|aws_secret)[=: ]+[A-Za-z0-9/+=]{40}', replacement)
    val = replace(val, r'\\\\bgh[posr]_[A-Za-z0-9]{36,}\\\\b', replacement)
    val = replace(val, r'(?i)(?:api[_-]?key|apikey|api[_-]?secret)[=: ]+[A-Za-z0-9\\\\-._~]{16,}', replacement)

    . = set!(., [field_path], val)
  }
}
`,

  dlp_custom_regex_masking: `# Custom Regex Masking
# User-defined regex pattern applied to specified fields

fields = ["message"]
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

  dlp_json_field_removal: `# JSON Field Removal (GDPR / HIPAA / PCI-DSS)
# Drops specified fields from structured log events

remove_fields = ["password", "secret", "token"]

for_each(remove_fields) -> |_idx, field_path| {
  . = remove!(., [field_path], compact: false)
}
`,
};
