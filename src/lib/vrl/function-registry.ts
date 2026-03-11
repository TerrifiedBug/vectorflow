// src/lib/vrl/function-registry.ts

export interface VrlParam {
  name: string
  type: string
  required: boolean
  description: string
  default?: string
}

export interface VrlFunction {
  name: string
  category: string
  description: string
  params: VrlParam[]
  returnType: string
  fallible: boolean
  example: string
}

export const VRL_FUNCTIONS: VrlFunction[] = [
  // ── Parse ──────────────────────────────────────────────────────────
  {
    name: "parse_json",
    category: "Parse",
    description: "Parses a JSON string into a value.",
    params: [
      { name: "value", type: "string", required: true, description: "The JSON string to parse." },
    ],
    returnType: "any",
    fallible: true,
    example: '.parsed = parse_json!(.message)',
  },
  {
    name: "parse_syslog",
    category: "Parse",
    description: "Parses a syslog message (RFC 5424/3164) into a structured object.",
    params: [
      { name: "value", type: "string", required: true, description: "The syslog message string." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_syslog!(.message)',
  },
  {
    name: "parse_csv",
    category: "Parse",
    description: "Parses a CSV row into an array of strings.",
    params: [
      { name: "value", type: "string", required: true, description: "The CSV row string." },
      { name: "delimiter", type: "string", required: false, description: "Field delimiter.", default: "," },
    ],
    returnType: "array",
    fallible: true,
    example: '.columns = parse_csv!(.message)',
  },
  {
    name: "parse_key_value",
    category: "Parse",
    description: "Parses a string containing key-value pairs into an object.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to parse." },
      { name: "field_delimiter", type: "string", required: false, description: "Delimiter between key-value pairs.", default: " " },
      { name: "key_value_delimiter", type: "string", required: false, description: "Delimiter between key and value.", default: "=" },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_key_value!(.message)',
  },
  {
    name: "parse_grok",
    category: "Parse",
    description: "Parses a string using a Grok pattern.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to parse." },
      { name: "pattern", type: "string", required: true, description: "The Grok pattern." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_grok!(.message, "%{COMBINEDAPACHELOG}")',
  },
  {
    name: "parse_regex",
    category: "Parse",
    description: "Parses a string using a regular expression with named capture groups.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to parse." },
      { name: "pattern", type: "regex", required: true, description: "Regex pattern with named captures." },
      { name: "numeric_groups", type: "boolean", required: false, description: "Include unnamed numeric capture groups.", default: "false" },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_regex!(.message, r\'user=(?P<user>\\w+)\')',
  },
  {
    name: "parse_timestamp",
    category: "Parse",
    description: "Parses a string into a timestamp using a strftime format.",
    params: [
      { name: "value", type: "string", required: true, description: "The timestamp string." },
      { name: "format", type: "string", required: true, description: "The strftime format string." },
    ],
    returnType: "timestamp",
    fallible: true,
    example: '.timestamp = parse_timestamp!(.ts, format: "%Y-%m-%dT%H:%M:%SZ")',
  },
  {
    name: "parse_url",
    category: "Parse",
    description: "Parses a URL string into its components (scheme, host, port, path, query, fragment).",
    params: [
      { name: "value", type: "string", required: true, description: "The URL string to parse." },
      { name: "default_known_ports", type: "boolean", required: false, description: "Populate default ports for known schemes.", default: "false" },
    ],
    returnType: "object",
    fallible: true,
    example: '.url_parts = parse_url!(.request_url)',
  },
  {
    name: "parse_query_string",
    category: "Parse",
    description: "Parses a URL query string into a key-value object.",
    params: [
      { name: "value", type: "string", required: true, description: "The query string." },
    ],
    returnType: "object",
    fallible: false,
    example: '.params = parse_query_string(.url.query)',
  },
  {
    name: "parse_xml",
    category: "Parse",
    description: "Parses an XML string into a structured object.",
    params: [
      { name: "value", type: "string", required: true, description: "The XML string." },
    ],
    returnType: "object",
    fallible: true,
    example: '.data = parse_xml!(.message)',
  },
  {
    name: "parse_logfmt",
    category: "Parse",
    description: "Parses a logfmt-formatted string into an object.",
    params: [
      { name: "value", type: "string", required: true, description: "The logfmt string." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_logfmt!(.message)',
  },
  {
    name: "parse_common_log",
    category: "Parse",
    description: "Parses a Common Log Format (CLF) string.",
    params: [
      { name: "value", type: "string", required: true, description: "The log line." },
      { name: "timestamp_format", type: "string", required: false, description: "Custom timestamp format." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_common_log!(.message)',
  },
  {
    name: "parse_apache_log",
    category: "Parse",
    description: "Parses an Apache access log line (common or combined format).",
    params: [
      { name: "value", type: "string", required: true, description: "The log line." },
      { name: "format", type: "string", required: true, description: 'Log format: "common" or "combined".' },
      { name: "timestamp_format", type: "string", required: false, description: "Custom timestamp format." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_apache_log!(.message, format: "combined")',
  },
  {
    name: "parse_nginx_log",
    category: "Parse",
    description: "Parses an Nginx access log line (combined or error format).",
    params: [
      { name: "value", type: "string", required: true, description: "The log line." },
      { name: "format", type: "string", required: true, description: 'Log format: "combined" or "error".' },
      { name: "timestamp_format", type: "string", required: false, description: "Custom timestamp format." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_nginx_log!(.message, format: "combined")',
  },
  {
    name: "parse_int",
    category: "Parse",
    description: "Parses a string as an integer with a given base.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to parse." },
      { name: "base", type: "integer", required: false, description: "Numeric base (2-36).", default: "10" },
    ],
    returnType: "integer",
    fallible: true,
    example: '.port = parse_int!(.port_str)',
  },
  {
    name: "parse_float",
    category: "Parse",
    description: "Parses a string as a floating-point number.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to parse." },
    ],
    returnType: "float",
    fallible: true,
    example: '.latency = parse_float!(.latency_str)',
  },
  {
    name: "parse_duration",
    category: "Parse",
    description: "Parses a duration string (e.g., '2m30s') into nanoseconds.",
    params: [
      { name: "value", type: "string", required: true, description: "The duration string." },
      { name: "output", type: "string", required: true, description: 'Output unit: "s", "ms", "ns".' },
    ],
    returnType: "float",
    fallible: true,
    example: '.duration_ms = parse_duration!(.duration, output: "ms")',
  },
  {
    name: "parse_tokens",
    category: "Parse",
    description: "Parses a string into tokens, splitting on whitespace and respecting quotes.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to tokenize." },
    ],
    returnType: "array",
    fallible: true,
    example: '.tokens = parse_tokens!(.message)',
  },
  {
    name: "parse_groks",
    category: "Parse",
    description: "Parses a string using multiple Grok patterns, returning the first match.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to parse." },
      { name: "patterns", type: "array", required: true, description: "Array of Grok patterns to try." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_groks!(.message, patterns: ["%{SYSLOGLINE}", "%{COMMONAPACHELOG}"])',
  },
  {
    name: "parse_user_agent",
    category: "Parse",
    description: "Parses a user agent string into browser, OS, and device info.",
    params: [
      { name: "value", type: "string", required: true, description: "The user agent string." },
    ],
    returnType: "object",
    fallible: true,
    example: '.ua = parse_user_agent!(.user_agent)',
  },
  {
    name: "parse_cef",
    category: "Parse",
    description: "Parses a CEF (Common Event Format) string.",
    params: [
      { name: "value", type: "string", required: true, description: "The CEF string." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_cef!(.message)',
  },
  {
    name: "parse_aws_alb_log",
    category: "Parse",
    description: "Parses an AWS ALB access log line.",
    params: [
      { name: "value", type: "string", required: true, description: "The ALB log line." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_aws_alb_log!(.message)',
  },
  {
    name: "parse_aws_cloudwatch_log_subscription_message",
    category: "Parse",
    description: "Parses an AWS CloudWatch Logs subscription message.",
    params: [
      { name: "value", type: "string", required: true, description: "The CloudWatch log subscription JSON." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_aws_cloudwatch_log_subscription_message!(.message)',
  },
  {
    name: "parse_aws_vpc_flow_log",
    category: "Parse",
    description: "Parses an AWS VPC flow log line.",
    params: [
      { name: "value", type: "string", required: true, description: "The VPC flow log line." },
      { name: "format", type: "string", required: false, description: "Log format string." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_aws_vpc_flow_log!(.message)',
  },
  {
    name: "parse_linux_authorization",
    category: "Parse",
    description: "Parses a Linux authorization log line (auth.log).",
    params: [
      { name: "value", type: "string", required: true, description: "The auth log line." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_linux_authorization!(.message)',
  },
  {
    name: "parse_klog",
    category: "Parse",
    description: "Parses a klog (Kubernetes log) formatted string.",
    params: [
      { name: "value", type: "string", required: true, description: "The klog string." },
    ],
    returnType: "object",
    fallible: true,
    example: '. = parse_klog!(.message)',
  },

  // ── String ─────────────────────────────────────────────────────────
  {
    name: "contains",
    category: "String",
    description: "Checks if a string contains a substring.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to search." },
      { name: "substring", type: "string", required: true, description: "The substring to find." },
      { name: "case_sensitive", type: "boolean", required: false, description: "Case-sensitive search.", default: "true" },
    ],
    returnType: "boolean",
    fallible: false,
    example: 'if contains(.message, "error") { .level = "error" }',
  },
  {
    name: "starts_with",
    category: "String",
    description: "Checks if a string starts with a prefix.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to check." },
      { name: "substring", type: "string", required: true, description: "The prefix." },
      { name: "case_sensitive", type: "boolean", required: false, description: "Case-sensitive check.", default: "true" },
    ],
    returnType: "boolean",
    fallible: false,
    example: 'if starts_with(.path, "/api") { .is_api = true }',
  },
  {
    name: "ends_with",
    category: "String",
    description: "Checks if a string ends with a suffix.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to check." },
      { name: "substring", type: "string", required: true, description: "The suffix." },
      { name: "case_sensitive", type: "boolean", required: false, description: "Case-sensitive check.", default: "true" },
    ],
    returnType: "boolean",
    fallible: false,
    example: 'if ends_with(.file, ".log") { .is_log = true }',
  },
  {
    name: "slice",
    category: "String",
    description: "Extracts a substring by character index.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to slice." },
      { name: "start", type: "integer", required: true, description: "Start index (inclusive)." },
      { name: "end", type: "integer", required: false, description: "End index (exclusive)." },
    ],
    returnType: "string",
    fallible: false,
    example: '.prefix = slice(.message, 0, 10)',
  },
  {
    name: "replace",
    category: "String",
    description: "Replaces occurrences of a pattern in a string.",
    params: [
      { name: "value", type: "string", required: true, description: "The input string." },
      { name: "pattern", type: "string | regex", required: true, description: "Pattern to match." },
      { name: "with", type: "string", required: true, description: "Replacement string." },
      { name: "count", type: "integer", required: false, description: "Max replacements. -1 for all.", default: "-1" },
    ],
    returnType: "string",
    fallible: false,
    example: '.message = replace(.message, "-", "_")',
  },
  {
    name: "split",
    category: "String",
    description: "Splits a string into an array by a separator.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to split." },
      { name: "pattern", type: "string | regex", required: true, description: "Separator pattern." },
      { name: "limit", type: "integer", required: false, description: "Max number of splits." },
    ],
    returnType: "array",
    fallible: false,
    example: '.parts = split(.path, "/")',
  },
  {
    name: "join",
    category: "String",
    description: "Joins an array of strings with a separator.",
    params: [
      { name: "value", type: "array", required: true, description: "Array of strings to join." },
      { name: "separator", type: "string", required: false, description: "Separator between elements.", default: "" },
    ],
    returnType: "string",
    fallible: true,
    example: '.tags_str = join!(.tags, ",")',
  },
  {
    name: "upcase",
    category: "String",
    description: "Converts a string to uppercase.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to convert." },
    ],
    returnType: "string",
    fallible: false,
    example: '.level = upcase(.level)',
  },
  {
    name: "downcase",
    category: "String",
    description: "Converts a string to lowercase.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to convert." },
    ],
    returnType: "string",
    fallible: false,
    example: '.method = downcase(.method)',
  },
  {
    name: "strip_whitespace",
    category: "String",
    description: "Removes leading and trailing whitespace from a string.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to trim." },
    ],
    returnType: "string",
    fallible: false,
    example: '.name = strip_whitespace(.name)',
  },
  {
    name: "truncate",
    category: "String",
    description: "Truncates a string to a maximum number of characters.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to truncate." },
      { name: "limit", type: "integer", required: true, description: "Maximum character count." },
      { name: "ellipsis", type: "boolean", required: false, description: "Append '...' if truncated.", default: "false" },
      { name: "suffix", type: "string", required: false, description: "Custom suffix for truncation." },
    ],
    returnType: "string",
    fallible: false,
    example: '.summary = truncate(.message, 100, suffix: "...")',
  },
  {
    name: "strlen",
    category: "String",
    description: "Returns the length of a string in characters.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to measure." },
    ],
    returnType: "integer",
    fallible: false,
    example: '.msg_length = strlen(.message)',
  },
  {
    name: "match",
    category: "String",
    description: "Checks if a string matches a regular expression.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to test." },
      { name: "pattern", type: "regex", required: true, description: "The regex pattern." },
    ],
    returnType: "boolean",
    fallible: false,
    example: 'if match(.message, r\'\\d{3}\') { .has_code = true }',
  },
  {
    name: "match_any",
    category: "String",
    description: "Checks if a string matches any of the provided patterns.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to test." },
      { name: "patterns", type: "array", required: true, description: "Array of regex patterns." },
    ],
    returnType: "boolean",
    fallible: false,
    example: 'if match_any(.message, [r\'error\', r\'warn\']) { .alert = true }',
  },
  {
    name: "find",
    category: "String",
    description: "Finds the first occurrence of a pattern in a string and returns its index.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to search." },
      { name: "pattern", type: "string | regex", required: true, description: "Pattern to find." },
    ],
    returnType: "integer",
    fallible: false,
    example: '.pos = find(.message, "error")',
  },
  {
    name: "reverse",
    category: "String",
    description: "Reverses a string.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to reverse." },
    ],
    returnType: "string",
    fallible: false,
    example: '.reversed = reverse(.code)',
  },
  {
    name: "capitalize",
    category: "String",
    description: "Capitalizes the first character of a string.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to capitalize." },
    ],
    returnType: "string",
    fallible: false,
    example: '.name = capitalize(.name)',
  },
  {
    name: "is_empty",
    category: "String",
    description: "Checks if a string is empty.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to check." },
    ],
    returnType: "boolean",
    fallible: false,
    example: 'if is_empty(.name) { .name = "unknown" }',
  },
  {
    name: "strip_ansi_escape_codes",
    category: "String",
    description: "Removes ANSI escape codes from a string.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to clean." },
    ],
    returnType: "string",
    fallible: false,
    example: '.clean_output = strip_ansi_escape_codes(.output)',
  },
  {
    name: "camelcase",
    category: "String",
    description: "Converts a string to camelCase.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to convert." },
    ],
    returnType: "string",
    fallible: false,
    example: '.field_name = camelcase("my_field_name")',
  },
  {
    name: "snakecase",
    category: "String",
    description: "Converts a string to snake_case.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to convert." },
    ],
    returnType: "string",
    fallible: false,
    example: '.field_name = snakecase("myFieldName")',
  },
  {
    name: "screaming_snakecase",
    category: "String",
    description: "Converts a string to SCREAMING_SNAKE_CASE.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to convert." },
    ],
    returnType: "string",
    fallible: false,
    example: '.const_name = screaming_snakecase("myConstant")',
  },
  {
    name: "string",
    category: "String",
    description: "Creates a string from a value (type constructor).",
    params: [
      { name: "value", type: "any", required: true, description: "The value to convert to string." },
    ],
    returnType: "string",
    fallible: true,
    example: '.text = string!(.value)',
  },

  // ── Type Coercion ──────────────────────────────────────────────────
  {
    name: "to_string",
    category: "Type",
    description: "Converts any value to a string representation.",
    params: [
      { name: "value", type: "any", required: true, description: "The value to convert." },
    ],
    returnType: "string",
    fallible: false,
    example: '.status_str = to_string(.status_code)',
  },
  {
    name: "to_int",
    category: "Type",
    description: "Converts a value to an integer.",
    params: [
      { name: "value", type: "string | float | boolean | timestamp", required: true, description: "The value to convert." },
    ],
    returnType: "integer",
    fallible: true,
    example: '.status_code = to_int!(.status_code)',
  },
  {
    name: "to_float",
    category: "Type",
    description: "Converts a value to a float.",
    params: [
      { name: "value", type: "string | integer | boolean | timestamp", required: true, description: "The value to convert." },
    ],
    returnType: "float",
    fallible: true,
    example: '.latency = to_float!(.latency)',
  },
  {
    name: "to_bool",
    category: "Type",
    description: "Converts a value to a boolean.",
    params: [
      { name: "value", type: "string | integer | float | null | boolean", required: true, description: "The value to convert." },
    ],
    returnType: "boolean",
    fallible: true,
    example: '.enabled = to_bool!(.enabled)',
  },
  {
    name: "to_timestamp",
    category: "Type",
    description: "Parses a value into a timestamp.",
    params: [
      { name: "value", type: "string | integer | float", required: true, description: "The value to convert." },
      { name: "format", type: "string", required: false, description: "The strftime format to parse with." },
    ],
    returnType: "timestamp",
    fallible: true,
    example: '.timestamp = to_timestamp!(.ts)',
  },
  {
    name: "to_unix_timestamp",
    category: "Type",
    description: "Converts a timestamp to a Unix epoch number.",
    params: [
      { name: "value", type: "timestamp", required: true, description: "The timestamp to convert." },
      { name: "unit", type: "string", required: false, description: 'Output unit: "seconds", "milliseconds", "nanoseconds".', default: "seconds" },
    ],
    returnType: "integer",
    fallible: false,
    example: '.epoch = to_unix_timestamp(now(), unit: "seconds")',
  },
  {
    name: "to_regex",
    category: "Type",
    description: "Converts a string to a regex.",
    params: [
      { name: "value", type: "string", required: true, description: "The regex pattern string." },
    ],
    returnType: "regex",
    fallible: true,
    example: '.pattern = to_regex!(.filter_pattern)',
  },
  {
    name: "type_def",
    category: "Type",
    description: "Returns the type definition of a value as a string.",
    params: [
      { name: "value", type: "any", required: true, description: "The value to inspect." },
    ],
    returnType: "object",
    fallible: false,
    example: '.type_info = type_def(.message)',
  },
  {
    name: "tag_types_externally",
    category: "Type",
    description: "Wraps values in objects with type tags for external type-awareness.",
    params: [
      { name: "value", type: "any", required: true, description: "The value to tag." },
    ],
    returnType: "any",
    fallible: false,
    example: '. = tag_types_externally(.)',
  },

  // ── Number ─────────────────────────────────────────────────────────
  {
    name: "abs",
    category: "Number",
    description: "Returns the absolute value of a number.",
    params: [
      { name: "value", type: "integer | float", required: true, description: "The number." },
    ],
    returnType: "integer | float",
    fallible: false,
    example: '.diff = abs(.value_a - .value_b)',
  },
  {
    name: "ceil",
    category: "Number",
    description: "Rounds a number up to the specified precision.",
    params: [
      { name: "value", type: "integer | float", required: true, description: "The number to round up." },
      { name: "precision", type: "integer", required: false, description: "Decimal places to round to.", default: "0" },
    ],
    returnType: "integer | float",
    fallible: false,
    example: '.rounded = ceil(.latency, precision: 2)',
  },
  {
    name: "floor",
    category: "Number",
    description: "Rounds a number down to the specified precision.",
    params: [
      { name: "value", type: "integer | float", required: true, description: "The number to round down." },
      { name: "precision", type: "integer", required: false, description: "Decimal places to round to.", default: "0" },
    ],
    returnType: "integer | float",
    fallible: false,
    example: '.truncated = floor(.price)',
  },
  {
    name: "round",
    category: "Number",
    description: "Rounds a number to the specified precision.",
    params: [
      { name: "value", type: "integer | float", required: true, description: "The number to round." },
      { name: "precision", type: "integer", required: false, description: "Decimal places to round to.", default: "0" },
    ],
    returnType: "integer | float",
    fallible: false,
    example: '.rounded = round(.value, precision: 2)',
  },
  {
    name: "mod",
    category: "Number",
    description: "Returns the remainder of integer division.",
    params: [
      { name: "value", type: "integer", required: true, description: "The dividend." },
      { name: "modulus", type: "integer", required: true, description: "The divisor." },
    ],
    returnType: "integer",
    fallible: true,
    example: '.is_even = mod(.count, 2) == 0',
  },
  {
    name: "format_int",
    category: "Number",
    description: "Formats an integer as a string in the given base.",
    params: [
      { name: "value", type: "integer", required: true, description: "The number to format." },
      { name: "base", type: "integer", required: false, description: "Numeric base (2-36).", default: "10" },
    ],
    returnType: "string",
    fallible: true,
    example: '.hex = format_int!(.value, base: 16)',
  },
  {
    name: "format_number",
    category: "Number",
    description: "Formats a number as a human-readable string with grouping and decimal options.",
    params: [
      { name: "value", type: "integer | float", required: true, description: "The number to format." },
      { name: "scale", type: "integer", required: false, description: "Decimal places." },
      { name: "decimal_separator", type: "string", required: false, description: "Decimal separator character.", default: "." },
      { name: "grouping_separator", type: "string", required: false, description: "Thousands separator character.", default: "," },
    ],
    returnType: "string",
    fallible: false,
    example: '.display = format_number(.bytes, scale: 2, grouping_separator: ",")',
  },
  {
    name: "int",
    category: "Number",
    description: "Creates an integer from a value (type constructor).",
    params: [
      { name: "value", type: "any", required: true, description: "The value to convert to integer." },
    ],
    returnType: "integer",
    fallible: true,
    example: '.count = int!(.raw_count)',
  },
  {
    name: "float",
    category: "Number",
    description: "Creates a float from a value (type constructor).",
    params: [
      { name: "value", type: "any", required: true, description: "The value to convert to float." },
    ],
    returnType: "float",
    fallible: true,
    example: '.ratio = float!(.raw_ratio)',
  },

  // ── Encode/Decode ──────────────────────────────────────────────────
  {
    name: "encode_json",
    category: "Encode",
    description: "Encodes a value as a JSON string.",
    params: [
      { name: "value", type: "any", required: true, description: "The value to encode." },
    ],
    returnType: "string",
    fallible: false,
    example: '.json_str = encode_json(.data)',
  },
  {
    name: "encode_logfmt",
    category: "Encode",
    description: "Encodes an object as a logfmt string.",
    params: [
      { name: "value", type: "object", required: true, description: "The object to encode." },
    ],
    returnType: "string",
    fallible: true,
    example: '.message = encode_logfmt!({"level": "info", "msg": .message})',
  },
  {
    name: "encode_base64",
    category: "Encode",
    description: "Encodes a string as Base64.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to encode." },
      { name: "charset", type: "string", required: false, description: 'Charset: "standard" or "url_safe".', default: "standard" },
      { name: "padding", type: "boolean", required: false, description: "Include padding.", default: "true" },
    ],
    returnType: "string",
    fallible: false,
    example: '.encoded = encode_base64(.data)',
  },
  {
    name: "decode_base64",
    category: "Encode",
    description: "Decodes a Base64-encoded string.",
    params: [
      { name: "value", type: "string", required: true, description: "The Base64 string." },
      { name: "charset", type: "string", required: false, description: 'Charset: "standard" or "url_safe".', default: "standard" },
    ],
    returnType: "string",
    fallible: true,
    example: '.decoded = decode_base64!(.encoded)',
  },
  {
    name: "encode_base16",
    category: "Encode",
    description: "Encodes a string to Base16 (hex).",
    params: [
      { name: "value", type: "string", required: true, description: "The string to encode." },
    ],
    returnType: "string",
    fallible: false,
    example: '.hex = encode_base16(.raw)',
  },
  {
    name: "decode_base16",
    category: "Encode",
    description: "Decodes a Base16 (hex) encoded string.",
    params: [
      { name: "value", type: "string", required: true, description: "The hex string." },
    ],
    returnType: "string",
    fallible: true,
    example: '.decoded = decode_base16!(.hex_value)',
  },
  {
    name: "encode_percent",
    category: "Encode",
    description: "Percent-encodes a string (URL encoding).",
    params: [
      { name: "value", type: "string", required: true, description: "The string to encode." },
      { name: "ascii_set", type: "string", required: false, description: 'Character set to encode.', default: "NON_ALPHANUMERIC" },
    ],
    returnType: "string",
    fallible: false,
    example: '.encoded_url = encode_percent(.path)',
  },
  {
    name: "decode_percent",
    category: "Encode",
    description: "Decodes a percent-encoded (URL encoded) string.",
    params: [
      { name: "value", type: "string", required: true, description: "The percent-encoded string." },
    ],
    returnType: "string",
    fallible: true,
    example: '.decoded = decode_percent!(.url_param)',
  },
  {
    name: "encode_punycode",
    category: "Encode",
    description: "Encodes a string to Punycode (internationalized domain names).",
    params: [
      { name: "value", type: "string", required: true, description: "The string to encode." },
    ],
    returnType: "string",
    fallible: true,
    example: '.ascii_domain = encode_punycode!(.domain)',
  },
  {
    name: "decode_punycode",
    category: "Encode",
    description: "Decodes a Punycode-encoded string.",
    params: [
      { name: "value", type: "string", required: true, description: "The Punycode string." },
    ],
    returnType: "string",
    fallible: true,
    example: '.unicode_domain = decode_punycode!(.ascii_domain)',
  },
  {
    name: "encode_snappy",
    category: "Encode",
    description: "Compresses a string using Snappy compression.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to compress." },
    ],
    returnType: "string",
    fallible: false,
    example: '.compressed = encode_snappy(.data)',
  },
  {
    name: "decode_snappy",
    category: "Encode",
    description: "Decompresses a Snappy-compressed string.",
    params: [
      { name: "value", type: "string", required: true, description: "The compressed string." },
    ],
    returnType: "string",
    fallible: true,
    example: '.data = decode_snappy!(.compressed)',
  },
  {
    name: "encode_zlib",
    category: "Encode",
    description: "Compresses a string using zlib compression.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to compress." },
      { name: "compression_level", type: "integer", required: false, description: "Compression level (0-9).", default: "6" },
    ],
    returnType: "string",
    fallible: false,
    example: '.compressed = encode_zlib(.data)',
  },
  {
    name: "decode_zlib",
    category: "Encode",
    description: "Decompresses a zlib-compressed string.",
    params: [
      { name: "value", type: "string", required: true, description: "The compressed string." },
    ],
    returnType: "string",
    fallible: true,
    example: '.data = decode_zlib!(.compressed)',
  },
  {
    name: "encode_gzip",
    category: "Encode",
    description: "Compresses a string using gzip compression.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to compress." },
      { name: "compression_level", type: "integer", required: false, description: "Compression level (0-9).", default: "6" },
    ],
    returnType: "string",
    fallible: false,
    example: '.compressed = encode_gzip(.data)',
  },
  {
    name: "decode_gzip",
    category: "Encode",
    description: "Decompresses a gzip-compressed string.",
    params: [
      { name: "value", type: "string", required: true, description: "The compressed string." },
    ],
    returnType: "string",
    fallible: true,
    example: '.data = decode_gzip!(.compressed)',
  },
  {
    name: "encode_zstd",
    category: "Encode",
    description: "Compresses a string using Zstandard compression.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to compress." },
      { name: "compression_level", type: "integer", required: false, description: "Compression level.", default: "3" },
    ],
    returnType: "string",
    fallible: false,
    example: '.compressed = encode_zstd(.data)',
  },
  {
    name: "decode_zstd",
    category: "Encode",
    description: "Decompresses a Zstandard-compressed string.",
    params: [
      { name: "value", type: "string", required: true, description: "The compressed string." },
    ],
    returnType: "string",
    fallible: true,
    example: '.data = decode_zstd!(.compressed)',
  },
  {
    name: "decode_mime_q",
    category: "Encode",
    description: "Decodes a MIME Q-encoded or B-encoded string (email headers).",
    params: [
      { name: "value", type: "string", required: true, description: "The MIME encoded string." },
    ],
    returnType: "string",
    fallible: true,
    example: '.subject = decode_mime_q!(.raw_subject)',
  },

  // ── Hash/Crypto ────────────────────────────────────────────────────
  {
    name: "sha1",
    category: "Hash",
    description: "Computes a SHA-1 hash of a value.",
    params: [
      { name: "value", type: "string", required: true, description: "The value to hash." },
    ],
    returnType: "string",
    fallible: false,
    example: '.hash = sha1(.message)',
  },
  {
    name: "sha2",
    category: "Hash",
    description: "Computes a SHA-2 hash of a value.",
    params: [
      { name: "value", type: "string", required: true, description: "The value to hash." },
      { name: "variant", type: "string", required: false, description: 'SHA variant: "SHA-224", "SHA-256", "SHA-384", "SHA-512".', default: "SHA-256" },
    ],
    returnType: "string",
    fallible: false,
    example: '.hash = sha2(.message)',
  },
  {
    name: "md5",
    category: "Hash",
    description: "Computes an MD5 hash of a value.",
    params: [
      { name: "value", type: "string", required: true, description: "The value to hash." },
    ],
    returnType: "string",
    fallible: false,
    example: '.hash = md5(.message)',
  },
  {
    name: "hmac",
    category: "Hash",
    description: "Computes an HMAC signature.",
    params: [
      { name: "value", type: "string", required: true, description: "The value to sign." },
      { name: "key", type: "string", required: true, description: "The secret key." },
      { name: "algorithm", type: "string", required: false, description: 'Hash algorithm: "SHA-256".', default: "SHA-256" },
    ],
    returnType: "string",
    fallible: false,
    example: '.signature = hmac(.payload, "secret_key")',
  },
  {
    name: "sha3",
    category: "Hash",
    description: "Computes a SHA-3 hash of a value.",
    params: [
      { name: "value", type: "string", required: true, description: "The value to hash." },
      { name: "variant", type: "string", required: false, description: 'SHA-3 variant: "SHA3-224", "SHA3-256", "SHA3-384", "SHA3-512".', default: "SHA3-256" },
    ],
    returnType: "string",
    fallible: false,
    example: '.hash = sha3(.message)',
  },
  {
    name: "encrypt",
    category: "Hash",
    description: "Encrypts a value using the specified algorithm.",
    params: [
      { name: "plaintext", type: "string", required: true, description: "The value to encrypt." },
      { name: "algorithm", type: "string", required: true, description: 'Encryption algorithm: "AES-256-CFB", "AES-192-CFB", "AES-128-CFB".' },
      { name: "key", type: "string", required: true, description: "The encryption key." },
      { name: "iv", type: "string", required: true, description: "The initialization vector." },
    ],
    returnType: "string",
    fallible: true,
    example: '.encrypted = encrypt!(.secret, "AES-256-CFB", key: .key, iv: .iv)',
  },
  {
    name: "decrypt",
    category: "Hash",
    description: "Decrypts a value using the specified algorithm.",
    params: [
      { name: "ciphertext", type: "string", required: true, description: "The value to decrypt." },
      { name: "algorithm", type: "string", required: true, description: 'Decryption algorithm: "AES-256-CFB", "AES-192-CFB", "AES-128-CFB".' },
      { name: "key", type: "string", required: true, description: "The decryption key." },
      { name: "iv", type: "string", required: true, description: "The initialization vector." },
    ],
    returnType: "string",
    fallible: true,
    example: '.decrypted = decrypt!(.encrypted, "AES-256-CFB", key: .key, iv: .iv)',
  },

  // ── Object/Array ───────────────────────────────────────────────────
  {
    name: "keys",
    category: "Object",
    description: "Returns the keys of an object as an array.",
    params: [
      { name: "value", type: "object", required: true, description: "The object." },
    ],
    returnType: "array",
    fallible: false,
    example: '.field_names = keys(.)',
  },
  {
    name: "values",
    category: "Object",
    description: "Returns the values of an object as an array.",
    params: [
      { name: "value", type: "object", required: true, description: "The object." },
    ],
    returnType: "array",
    fallible: false,
    example: '.field_values = values(.metadata)',
  },
  {
    name: "length",
    category: "Object",
    description: "Returns the length of a string, array, or object.",
    params: [
      { name: "value", type: "string | array | object", required: true, description: "The value to measure." },
    ],
    returnType: "integer",
    fallible: false,
    example: '.tag_count = length(.tags)',
  },
  {
    name: "flatten",
    category: "Object",
    description: "Flattens a nested array into a single-level array.",
    params: [
      { name: "value", type: "array", required: true, description: "The nested array." },
    ],
    returnType: "array",
    fallible: false,
    example: '.flat_list = flatten(.nested_tags)',
  },
  {
    name: "compact",
    category: "Object",
    description: "Removes null values from an object or array.",
    params: [
      { name: "value", type: "object | array", required: true, description: "The value to compact." },
    ],
    returnType: "object | array",
    fallible: false,
    example: '. = compact(.)',
  },
  {
    name: "merge",
    category: "Object",
    description: "Merges two objects. Later values win on conflict.",
    params: [
      { name: "to", type: "object", required: true, description: "The base object." },
      { name: "from", type: "object", required: true, description: "The object to merge in." },
      { name: "deep", type: "boolean", required: false, description: "Recursively merge nested objects.", default: "false" },
    ],
    returnType: "object",
    fallible: false,
    example: '. = merge(., .extra_fields, deep: true)',
  },
  {
    name: "append",
    category: "Object",
    description: "Appends a value to an array.",
    params: [
      { name: "value", type: "array", required: true, description: "The array." },
      { name: "item", type: "any", required: true, description: "The value to append." },
    ],
    returnType: "array",
    fallible: false,
    example: '.tags = append(.tags, "processed")',
  },
  {
    name: "push",
    category: "Object",
    description: "Pushes a value onto the end of an array (alias for append).",
    params: [
      { name: "value", type: "array", required: true, description: "The array." },
      { name: "item", type: "any", required: true, description: "The value to push." },
    ],
    returnType: "array",
    fallible: false,
    example: '.items = push(.items, "new_item")',
  },
  {
    name: "includes",
    category: "Object",
    description: "Checks if an array contains a value.",
    params: [
      { name: "value", type: "array", required: true, description: "The array to search." },
      { name: "item", type: "any", required: true, description: "The value to find." },
    ],
    returnType: "boolean",
    fallible: false,
    example: 'if includes(.tags, "production") { .env = "prod" }',
  },
  {
    name: "unique",
    category: "Object",
    description: "Returns unique elements of an array.",
    params: [
      { name: "value", type: "array", required: true, description: "The array." },
    ],
    returnType: "array",
    fallible: false,
    example: '.tags = unique(.tags)',
  },
  {
    name: "map_values",
    category: "Object",
    description: "Applies a closure to each value in an object.",
    params: [
      { name: "value", type: "object", required: true, description: "The object." },
      { name: "closure", type: "closure", required: true, description: "Function to apply to each value." },
    ],
    returnType: "object",
    fallible: false,
    example: '.tags = map_values(.tags) -> |_key, value| { downcase!(value) }',
  },
  {
    name: "map_keys",
    category: "Object",
    description: "Applies a closure to each key in an object.",
    params: [
      { name: "value", type: "object", required: true, description: "The object." },
      { name: "closure", type: "closure", required: true, description: "Function to apply to each key." },
    ],
    returnType: "object",
    fallible: false,
    example: '. = map_keys(.) -> |key| { downcase(key) }',
  },
  {
    name: "for_each",
    category: "Object",
    description: "Iterates over an object or array, executing a closure for each element.",
    params: [
      { name: "value", type: "object | array", required: true, description: "The value to iterate." },
      { name: "closure", type: "closure", required: true, description: "Function to execute for each element." },
    ],
    returnType: "null",
    fallible: false,
    example: 'for_each(.items) -> |_index, item| { log(item) }',
  },
  {
    name: "filter",
    category: "Object",
    description: "Filters an object or array using a closure predicate.",
    params: [
      { name: "value", type: "object | array", required: true, description: "The value to filter." },
      { name: "closure", type: "closure", required: true, description: "Predicate function returning boolean." },
    ],
    returnType: "object | array",
    fallible: false,
    example: '.errors = filter(.logs) -> |_index, item| { item.level == "error" }',
  },
  {
    name: "object",
    category: "Object",
    description: "Creates an object from a value (type constructor).",
    params: [
      { name: "value", type: "any", required: true, description: "The value to convert to object." },
    ],
    returnType: "object",
    fallible: true,
    example: '.obj = object!(.raw)',
  },
  {
    name: "array",
    category: "Object",
    description: "Creates an array from a value (type constructor).",
    params: [
      { name: "value", type: "any", required: true, description: "The value to convert to array." },
    ],
    returnType: "array",
    fallible: true,
    example: '.items = array!(.raw)',
  },
  {
    name: "chunks",
    category: "Object",
    description: "Splits an array into chunks of the specified size.",
    params: [
      { name: "value", type: "array", required: true, description: "The array to split." },
      { name: "chunk_size", type: "integer", required: true, description: "Size of each chunk." },
    ],
    returnType: "array",
    fallible: false,
    example: '.batches = chunks(.items, 10)',
  },

  // ── Path ───────────────────────────────────────────────────────────
  {
    name: "set",
    category: "Path",
    description: "Sets a value at a nested path.",
    params: [
      { name: "value", type: "object | array", required: true, description: "The target." },
      { name: "path", type: "array", required: true, description: "Path segments as an array." },
      { name: "data", type: "any", required: true, description: "The value to set." },
    ],
    returnType: "object | array",
    fallible: false,
    example: '. = set!(., ["a", "b"], 1)',
  },
  {
    name: "get",
    category: "Path",
    description: "Gets a value at a nested path.",
    params: [
      { name: "value", type: "object | array", required: true, description: "The target." },
      { name: "path", type: "array", required: true, description: "Path segments as an array." },
    ],
    returnType: "any",
    fallible: true,
    example: '.val = get!(., ["a", "b"])',
  },
  {
    name: "del",
    category: "Path",
    description: "Deletes a field and returns its value.",
    params: [
      { name: "target", type: "path", required: true, description: "The field path to delete." },
    ],
    returnType: "any",
    fallible: false,
    example: '.old_name = del(.temp_field)',
  },
  {
    name: "exists",
    category: "Path",
    description: "Checks if a field path exists.",
    params: [
      { name: "target", type: "path", required: true, description: "The field path to check." },
    ],
    returnType: "boolean",
    fallible: false,
    example: 'if exists(.hostname) { .has_host = true }',
  },
  {
    name: "remove",
    category: "Path",
    description: "Removes a value at a nested path, returning the removed value.",
    params: [
      { name: "value", type: "object | array", required: true, description: "The target." },
      { name: "path", type: "array", required: true, description: "Path segments as an array." },
      { name: "compact", type: "boolean", required: false, description: "Remove empty objects after removal.", default: "false" },
    ],
    returnType: "any",
    fallible: false,
    example: '.removed = remove!(., ["nested", "field"])',
  },

  // ── IP/Network ─────────────────────────────────────────────────────
  {
    name: "ip_cidr_contains",
    category: "IP",
    description: "Checks if an IP address is within a CIDR range.",
    params: [
      { name: "cidr", type: "string", required: true, description: "The CIDR range." },
      { name: "ip", type: "string", required: true, description: "The IP address." },
    ],
    returnType: "boolean",
    fallible: true,
    example: 'if ip_cidr_contains!("10.0.0.0/8", .client_ip) { .is_internal = true }',
  },
  {
    name: "ip_to_ipv6",
    category: "IP",
    description: "Converts an IPv4 address to IPv4-mapped IPv6.",
    params: [
      { name: "value", type: "string", required: true, description: "The IPv4 address." },
    ],
    returnType: "string",
    fallible: true,
    example: '.ipv6 = ip_to_ipv6!(.client_ip)',
  },
  {
    name: "ip_subnet",
    category: "IP",
    description: "Extracts the subnet from an IP address.",
    params: [
      { name: "value", type: "string", required: true, description: "The IP address." },
      { name: "subnet", type: "string", required: true, description: 'Subnet mask: "/24", "/16", etc.' },
    ],
    returnType: "string",
    fallible: true,
    example: '.subnet = ip_subnet!(.client_ip, "/24")',
  },
  {
    name: "community_id",
    category: "IP",
    description: "Generates a Community ID flow hash for network traffic.",
    params: [
      { name: "source_ip", type: "string", required: true, description: "Source IP." },
      { name: "destination_ip", type: "string", required: true, description: "Destination IP." },
      { name: "protocol", type: "integer", required: true, description: "IP protocol number." },
      { name: "source_port", type: "integer", required: false, description: "Source port." },
      { name: "destination_port", type: "integer", required: false, description: "Destination port." },
      { name: "seed", type: "integer", required: false, description: "Hash seed.", default: "0" },
    ],
    returnType: "string",
    fallible: true,
    example: '.community_id = community_id!(source_ip: .src_ip, destination_ip: .dst_ip, protocol: 6)',
  },
  {
    name: "ipv6_to_ipv4",
    category: "IP",
    description: "Converts an IPv6-mapped IPv4 address to IPv4.",
    params: [
      { name: "value", type: "string", required: true, description: "The IPv6-mapped IPv4 address." },
    ],
    returnType: "string",
    fallible: true,
    example: '.ipv4 = ipv6_to_ipv4!(.ip)',
  },
  {
    name: "ip_ntoa",
    category: "IP",
    description: "Converts a numeric IP address to a string representation.",
    params: [
      { name: "value", type: "integer", required: true, description: "The numeric IP address." },
    ],
    returnType: "string",
    fallible: true,
    example: '.ip_str = ip_ntoa!(.ip_num)',
  },
  {
    name: "ip_aton",
    category: "IP",
    description: "Converts a string IP address to its numeric representation.",
    params: [
      { name: "value", type: "string", required: true, description: "The IP address string." },
    ],
    returnType: "integer",
    fallible: true,
    example: '.ip_num = ip_aton!(.ip_address)',
  },

  // ── Timestamp ──────────────────────────────────────────────────────
  {
    name: "now",
    category: "Timestamp",
    description: "Returns the current UTC timestamp.",
    params: [],
    returnType: "timestamp",
    fallible: false,
    example: '.processed_at = now()',
  },
  {
    name: "format_timestamp",
    category: "Timestamp",
    description: "Formats a timestamp as a string using strftime format.",
    params: [
      { name: "value", type: "timestamp", required: true, description: "The timestamp." },
      { name: "format", type: "string", required: true, description: "The strftime format string." },
      { name: "timezone", type: "string", required: false, description: 'Timezone: "UTC", "America/New_York", etc.', default: "UTC" },
    ],
    returnType: "string",
    fallible: true,
    example: '.date = format_timestamp!(now(), format: "%Y-%m-%d")',
  },

  // ── Event/Diagnostic ───────────────────────────────────────────────
  {
    name: "log",
    category: "Event",
    description: "Emits a log message during VRL processing.",
    params: [
      { name: "value", type: "any", required: true, description: "The message to log." },
      { name: "level", type: "string", required: false, description: 'Log level: "trace", "debug", "info", "warn", "error".', default: "info" },
      { name: "rate_limit_secs", type: "integer", required: false, description: "Rate limit in seconds.", default: "1" },
    ],
    returnType: "null",
    fallible: false,
    example: 'log("Processing event", level: "debug")',
  },
  {
    name: "assert",
    category: "Event",
    description: "Asserts that a condition is true. Aborts on failure.",
    params: [
      { name: "condition", type: "boolean", required: true, description: "The condition to assert." },
      { name: "message", type: "string", required: true, description: "Error message on failure." },
    ],
    returnType: "null",
    fallible: true,
    example: 'assert!(exists(.message), "message field is required")',
  },
  {
    name: "assert_eq",
    category: "Event",
    description: "Asserts that two values are equal. Aborts on failure.",
    params: [
      { name: "left", type: "any", required: true, description: "First value." },
      { name: "right", type: "any", required: true, description: "Second value." },
      { name: "message", type: "string", required: false, description: "Error message on failure." },
    ],
    returnType: "null",
    fallible: true,
    example: 'assert_eq!(.version, 2, "unexpected version")',
  },
  {
    name: "set_semantic_meaning",
    category: "Event",
    description: "Annotates a field with semantic meaning (e.g., timestamp, message, host).",
    params: [
      { name: "target", type: "path", required: true, description: "The field path." },
      { name: "meaning", type: "string", required: true, description: 'Semantic meaning: "timestamp", "message", "host".' },
    ],
    returnType: "null",
    fallible: false,
    example: 'set_semantic_meaning(.ts, "timestamp")',
  },
  {
    name: "abort",
    category: "Event",
    description: "Terminates the VRL program and drops the event.",
    params: [],
    returnType: "never",
    fallible: false,
    example: 'if .level == "debug" { abort }',
  },
  {
    name: "get_secret",
    category: "Event",
    description: "Retrieves a secret value from the event's secret store.",
    params: [
      { name: "key", type: "string", required: true, description: "The secret key." },
    ],
    returnType: "string",
    fallible: true,
    example: '.api_key = get_secret!("api_key")',
  },
  {
    name: "set_secret",
    category: "Event",
    description: "Sets a secret value in the event's secret store.",
    params: [
      { name: "key", type: "string", required: true, description: "The secret key." },
      { name: "value", type: "string", required: true, description: "The secret value." },
    ],
    returnType: "null",
    fallible: false,
    example: 'set_secret("api_key", .extracted_key)',
  },
  {
    name: "remove_secret",
    category: "Event",
    description: "Removes a secret from the event's secret store.",
    params: [
      { name: "key", type: "string", required: true, description: "The secret key to remove." },
    ],
    returnType: "null",
    fallible: false,
    example: 'remove_secret("temp_key")',
  },

  // ── Enrichment ─────────────────────────────────────────────────────
  {
    name: "get_enrichment_table_record",
    category: "Enrichment",
    description: "Looks up a single record from an enrichment table.",
    params: [
      { name: "table", type: "string", required: true, description: "The enrichment table name." },
      { name: "condition", type: "object", required: true, description: "Lookup condition as key-value pairs." },
    ],
    returnType: "object",
    fallible: true,
    example: '.geo = get_enrichment_table_record!("geoip", {"ip": .client_ip})',
  },
  {
    name: "find_enrichment_table_records",
    category: "Enrichment",
    description: "Finds all matching records from an enrichment table.",
    params: [
      { name: "table", type: "string", required: true, description: "The enrichment table name." },
      { name: "condition", type: "object", required: true, description: "Search condition." },
    ],
    returnType: "array",
    fallible: true,
    example: '.matches = find_enrichment_table_records!("users", {"status": "active"})',
  },

  // ── Random ─────────────────────────────────────────────────────────
  {
    name: "uuid_v4",
    category: "Random",
    description: "Generates a random UUID v4.",
    params: [],
    returnType: "string",
    fallible: false,
    example: '.id = uuid_v4()',
  },
  {
    name: "uuid_v7",
    category: "Random",
    description: "Generates a time-sorted UUID v7.",
    params: [],
    returnType: "string",
    fallible: false,
    example: '.id = uuid_v7()',
  },
  {
    name: "random_int",
    category: "Random",
    description: "Generates a random integer within a range.",
    params: [
      { name: "min", type: "integer", required: true, description: "Minimum value (inclusive)." },
      { name: "max", type: "integer", required: true, description: "Maximum value (inclusive)." },
    ],
    returnType: "integer",
    fallible: true,
    example: '.sample_id = random_int!(0, 1000)',
  },
  {
    name: "random_float",
    category: "Random",
    description: "Generates a random float between 0.0 and 1.0.",
    params: [],
    returnType: "float",
    fallible: false,
    example: 'if random_float() < 0.1 { .sampled = true }',
  },
  {
    name: "random_bool",
    category: "Random",
    description: "Generates a random boolean.",
    params: [],
    returnType: "boolean",
    fallible: false,
    example: '.coin_flip = random_bool()',
  },
  {
    name: "random_bytes",
    category: "Random",
    description: "Generates random bytes.",
    params: [
      { name: "length", type: "integer", required: true, description: "Number of bytes." },
    ],
    returnType: "string",
    fallible: true,
    example: '.nonce = encode_base64(random_bytes!(16))',
  },

  // ── Security ────────────────────────────────────────────────────────
  {
    name: "redact",
    category: "Security",
    description: "Redacts sensitive data matching patterns in a string.",
    params: [
      { name: "value", type: "string", required: true, description: "The string to redact." },
      { name: "filters", type: "array", required: true, description: 'Array of filter types: "pattern", "us_social_security_number".' },
      { name: "redactor", type: "object", required: false, description: "Redaction config with type and replacement." },
      { name: "patterns", type: "array", required: false, description: "Array of regex patterns (when filter is 'pattern')." },
    ],
    returnType: "string",
    fallible: false,
    example: '.email = redact(.email, filters: ["pattern"], patterns: [r\'\\S+@\\S+\'])',
  },
]

// Lookup helpers
const functionMap = new Map(VRL_FUNCTIONS.map(f => [f.name, f]))

export function getVrlFunction(name: string): VrlFunction | undefined {
  return functionMap.get(name)
}

export function searchVrlFunctions(prefix: string): VrlFunction[] {
  const lower = prefix.toLowerCase()
  return VRL_FUNCTIONS.filter(f => f.name.toLowerCase().startsWith(lower))
}

export function getVrlCategories(): string[] {
  return [...new Set(VRL_FUNCTIONS.map(f => f.category))]
}

// ── AI Reference Builder ─────────────────────────────────────────────
// Replaces the static VRL_REFERENCE in src/lib/ai/vrl-reference.ts

const VRL_COMMON_PATTERNS = `## Common VRL Patterns

# Rename field
.new_name = del(.old_name)

# Add/set field
.environment = "production"

# Conditional field
if exists(.user_agent) {
  .browser = parse_regex!(.user_agent, r'(?P<browser>Chrome|Firefox|Safari)')
}

# Drop event
if .level == "debug" { abort }

# Coalesce (first non-null)
.host = .hostname ?? .host ?? "unknown"

# Error handling with ! (abort on error)
.parsed = parse_json!(.message)

# Error handling with ?? (fallback)
.parsed = parse_json(.message) ?? {}

# Map over nested fields
.tags = map_values(.tags) -> |_key, value| { downcase!(value) }

# Redact sensitive data
.email = redact(.email, filters: ["pattern"], redactor: {"type": "text", "replacement": "[REDACTED]"}, patterns: [r'\\S+@\\S+'])

# Type coercion
.status_code = to_int!(.status_code)
.timestamp = to_timestamp!(.timestamp)
`

export function buildVrlReferenceFromRegistry(): string {
  const categories = getVrlCategories()
  const sections: string[] = [
    "# VRL Function Reference (Vector Remap Language)",
    "# Compact reference for LLM context.",
    "",
  ]

  for (const category of categories) {
    const fns = VRL_FUNCTIONS.filter(f => f.category === category)
    sections.push(`## ${category} Functions`)

    for (const fn of fns) {
      const params = fn.params
        .map(p => {
          const opt = p.required ? "" : "?"
          return `${p.name}${opt}: ${p.type}`
        })
        .join(", ")
      const fallibleSuffix = fn.fallible ? " | error" : ""
      sections.push(`${fn.name}(${params}) -> ${fn.returnType}${fallibleSuffix}`)
      sections.push(`  ${fn.description}`)
      sections.push(`  Example: ${fn.example}`)
      sections.push("")
    }
  }

  sections.push(VRL_COMMON_PATTERNS)
  return sections.join("\n")
}
