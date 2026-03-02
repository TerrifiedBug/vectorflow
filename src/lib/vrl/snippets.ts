export interface VrlSnippet {
  id: string;
  name: string;
  description: string;
  category:
    | "Parsing"
    | "Filtering"
    | "Enrichment"
    | "Type Coercion"
    | "Encoding"
    | "String"
    | "Timestamp"
    | "Networking";
  code: string;
  placeholders?: string[];
}

export const VRL_SNIPPETS: VrlSnippet[] = [
  // ── Parsing ──────────────────────────────────────────
  { id: "parse-json", name: "parse_json", description: "Parse JSON from .message and merge into event (preserves existing fields)", category: "Parsing", code: '. = merge(., parse_json!(.message))', placeholders: [".message"] },
  { id: "parse-syslog", name: "parse_syslog", description: "Parse syslog-formatted message and merge into event", category: "Parsing", code: '. = merge(., parse_syslog!(.message))', placeholders: [".message"] },
  { id: "parse-csv", name: "parse_csv", description: "Parse a CSV row into an array", category: "Parsing", code: '.parsed = parse_csv!(.message)', placeholders: [".message"] },
  { id: "parse-key-value", name: "parse_key_value", description: "Parse key=value pairs and merge into event (preserves existing fields)", category: "Parsing", code: '. = merge(., parse_key_value!(.message))', placeholders: [".message"] },
  { id: "parse-regex", name: "parse_regex", description: "Extract fields using a named-capture regex and merge into event", category: "Parsing", code: ". = merge(., parse_regex!(.message, r'^(?P<timestamp>\\S+) (?P<level>\\w+) (?P<msg>.*)$'))", placeholders: [".message"] },
  { id: "parse-grok", name: "parse_grok", description: "Parse using a Grok pattern and merge into event", category: "Parsing", code: '. = merge(., parse_grok!(.message, "%{COMBINEDAPACHELOG}"))', placeholders: [".message", "%{COMBINEDAPACHELOG}"] },
  { id: "parse-xml", name: "parse_xml", description: "Parse an XML string into an object", category: "Parsing", code: '.parsed = parse_xml!(.message)', placeholders: [".message"] },
  { id: "parse-apache-log", name: "parse_apache_log", description: "Parse Apache combined log and merge into event", category: "Parsing", code: '. = merge(., parse_apache_log!(.message, format: "combined"))', placeholders: [".message"] },
  { id: "parse-nginx-log", name: "parse_nginx_log", description: "Parse Nginx combined log and merge into event", category: "Parsing", code: '. = merge(., parse_nginx_log!(.message, format: "combined"))', placeholders: [".message"] },

  // ── Filtering ────────────────────────────────────────
  { id: "del-field", name: "del(.field)", description: "Delete a field from the event", category: "Filtering", code: 'del(.field_name)', placeholders: [".field_name"] },
  { id: "keep-fields", name: "keep fields", description: "Keep only specified fields by rebuilding the event", category: "Filtering", code: '___tmp = .\n. = {}\n.message = ___tmp.message\n.timestamp = ___tmp.timestamp\n.host = ___tmp.host', placeholders: [".message", ".timestamp", ".host"] },
  { id: "if-else", name: "if/else condition", description: "Conditionally transform an event", category: "Filtering", code: 'if .level == "error" {\n  .priority = "high"\n} else {\n  .priority = "normal"\n}', placeholders: [".level", ".priority"] },
  { id: "abort", name: "abort", description: "Drop the current event (use in remap with drop_on_abort)", category: "Filtering", code: 'if .level == "debug" {\n  abort\n}', placeholders: [".level"] },
  { id: "assert", name: "assert", description: "Assert a condition or abort with a message", category: "Filtering", code: 'assert!(.message != "", message: "message field is required")', placeholders: [".message"] },
  { id: "compact", name: "compact", description: "Remove null and empty values from the event", category: "Filtering", code: '. = compact(.)' },

  // ── Enrichment ───────────────────────────────────────
  { id: "set-field", name: "set field", description: "Set a new field on the event", category: "Enrichment", code: '.environment = "production"', placeholders: [".environment"] },
  { id: "rename-field", name: "rename field", description: "Rename a field by copying and deleting the original", category: "Enrichment", code: '.new_name = del(.old_name)', placeholders: [".new_name", ".old_name"] },
  { id: "merge-objects", name: "merge objects", description: "Merge two objects together", category: "Enrichment", code: '. = merge(., {"source": "vectorflow", "processed": true})' },
  { id: "add-tags", name: "add tags", description: "Add tags to the event", category: "Enrichment", code: '.tags = push(.tags ?? [], "processed")', placeholders: [".tags"] },
  { id: "set-timestamp", name: "set timestamp", description: "Set the timestamp to the current time", category: "Enrichment", code: '.timestamp = now()' },
  { id: "uuid", name: "uuid_v4()", description: "Generate a unique ID for the event", category: "Enrichment", code: '.id = uuid_v4()' },

  // ── Type Coercion ────────────────────────────────────
  { id: "to-int", name: "to_int", description: "Convert a value to an integer", category: "Type Coercion", code: '.status_code = to_int!(.status_code)', placeholders: [".status_code"] },
  { id: "to-float", name: "to_float", description: "Convert a value to a float", category: "Type Coercion", code: '.duration = to_float!(.duration)', placeholders: [".duration"] },
  { id: "to-bool", name: "to_bool", description: "Convert a value to a boolean", category: "Type Coercion", code: '.is_active = to_bool!(.is_active)', placeholders: [".is_active"] },
  { id: "to-string", name: "to_string", description: "Convert a value to a string", category: "Type Coercion", code: '.code = to_string!(.code)', placeholders: [".code"] },
  { id: "to-timestamp", name: "to_timestamp", description: "Convert a value to a timestamp", category: "Type Coercion", code: '.timestamp = to_timestamp!(.timestamp)', placeholders: [".timestamp"] },

  // ── Encoding ─────────────────────────────────────────
  { id: "encode-json", name: "encode_json", description: "Encode an object to a JSON string", category: "Encoding", code: '.message = encode_json(.)' },
  { id: "encode-logfmt", name: "encode_logfmt", description: "Encode an object to logfmt format", category: "Encoding", code: '.message = encode_logfmt(.)' },
  { id: "encode-base64", name: "encode_base64", description: "Base64-encode a string", category: "Encoding", code: '.encoded = encode_base64(.message)', placeholders: [".message"] },
  { id: "decode-base64", name: "decode_base64", description: "Decode a base64-encoded string", category: "Encoding", code: '.decoded = decode_base64!(.encoded)', placeholders: [".encoded"] },

  // ── String ───────────────────────────────────────────
  { id: "downcase", name: "downcase", description: "Convert a string to lowercase", category: "String", code: '.level = downcase(.level)', placeholders: [".level"] },
  { id: "upcase", name: "upcase", description: "Convert a string to uppercase", category: "String", code: '.level = upcase(.level)', placeholders: [".level"] },
  { id: "strip-whitespace", name: "strip_whitespace", description: "Remove leading and trailing whitespace", category: "String", code: '.message = strip_whitespace(.message)', placeholders: [".message"] },
  { id: "replace", name: "replace", description: "Replace occurrences of a pattern in a string", category: "String", code: '.message = replace(.message, "old", "new")', placeholders: [".message"] },
  { id: "contains", name: "contains", description: "Check if a string contains a substring", category: "String", code: 'if contains(to_string(.message), "error") {\n  .has_error = true\n}', placeholders: [".message"] },
  { id: "starts-with", name: "starts_with", description: "Check if a string starts with a prefix", category: "String", code: 'if starts_with(to_string(.path), "/api") {\n  .is_api = true\n}', placeholders: [".path"] },
  { id: "split", name: "split", description: "Split a string into an array", category: "String", code: '.parts = split(to_string(.message), ",")', placeholders: [".message"] },
  { id: "join", name: "join", description: "Join an array into a string", category: "String", code: '.combined = join(.tags, ", ") ?? ""', placeholders: [".tags"] },

  // ── Timestamp ────────────────────────────────────────
  { id: "now", name: "now()", description: "Get the current timestamp", category: "Timestamp", code: '.processed_at = now()' },
  { id: "format-timestamp", name: "format_timestamp", description: "Format a timestamp as a custom string", category: "Timestamp", code: '.date = format_timestamp!(.timestamp, format: "%Y-%m-%d %H:%M:%S")', placeholders: [".timestamp"] },
  { id: "parse-timestamp", name: "parse_timestamp", description: "Parse a string into a timestamp", category: "Timestamp", code: '.timestamp = parse_timestamp!(.time, format: "%Y-%m-%dT%H:%M:%SZ")', placeholders: [".time"] },
  { id: "to-unix-timestamp", name: "to_unix_timestamp", description: "Convert a timestamp to Unix epoch seconds", category: "Timestamp", code: '.epoch = to_unix_timestamp(now())' },

  // ── Networking ───────────────────────────────────────
  { id: "ip-cidr-contains", name: "ip_cidr_contains", description: "Check if an IP is within a CIDR range", category: "Networking", code: 'if ip_cidr_contains!(.ip, "10.0.0.0/8") {\n  .is_internal = true\n}', placeholders: [".ip"] },
  { id: "parse-url", name: "parse_url", description: "Parse a URL into its components", category: "Networking", code: '.url_parts = parse_url!(.url)', placeholders: [".url"] },
  { id: "ip-to-ipv6", name: "ip_to_ipv6", description: "Convert an IPv4 address to IPv6-mapped format", category: "Networking", code: '.ipv6 = ip_to_ipv6(.ip) ?? .ip', placeholders: [".ip"] },
  { id: "community-id", name: "community_id", description: "Generate a Community ID flow hash for network events", category: "Networking", code: '.community_id = community_id!(source_ip: .src_ip, destination_ip: .dst_ip, source_port: .src_port, destination_port: .dst_port, protocol: 6)', placeholders: [".src_ip", ".dst_ip", ".src_port", ".dst_port"] },
];
