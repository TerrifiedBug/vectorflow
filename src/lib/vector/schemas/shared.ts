/**
 * Reusable schema factories for common Vector config sections.
 * Each factory returns a property object that can be spread into
 * a component's configSchema.properties.
 */

/* ------------------------------------------------------------------ */
/*  TLS                                                                */
/* ------------------------------------------------------------------ */

export function tlsSchema() {
  return {
    tls: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "Enable or disable TLS",
        },
        ca_file: { type: "string", description: "Path to CA certificate" },
        crt_file: { type: "string", description: "Path to client certificate" },
        key_file: { type: "string", description: "Path to private key" },
        key_pass: {
          type: "string",
          description: "Passphrase for encrypted key",
          sensitive: true,
        },
        server_name: {
          type: "string",
          description: "Server name for SNI",
        },
        alpn_protocols: {
          type: "array",
          items: { type: "string" },
          description: "ALPN protocols to support",
        },
        verify_certificate: {
          type: "boolean",
          description: "Verify certificate validity",
          default: true,
        },
        verify_hostname: {
          type: "boolean",
          description: "Verify hostname in certificate",
          default: true,
        },
      },
      description: "TLS configuration",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Batching                                                           */
/* ------------------------------------------------------------------ */

export function batchSchema(defaults?: {
  max_bytes?: string;
  timeout_secs?: string;
}) {
  const mb = defaults?.max_bytes ?? "10MB";
  const ts = defaults?.timeout_secs ?? "1";
  return {
    batch: {
      type: "object",
      properties: {
        max_bytes: {
          type: "number",
          description: `Max batch size in bytes (default: ${mb})`,
        },
        max_events: {
          type: "number",
          description: "Max events before flush",
        },
        timeout_secs: {
          type: "number",
          description: `Max batch age in seconds (default: ${ts})`,
        },
      },
      description: "Batching configuration",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Buffer                                                             */
/* ------------------------------------------------------------------ */

export function bufferSchema() {
  return {
    buffer: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["memory", "disk"],
          description: "Buffer type (default: memory)",
          default: "memory",
        },
        max_events: {
          type: "number",
          description: "Max events in buffer (default: 500)",
          default: 500,
        },
        when_full: {
          type: "string",
          enum: ["block", "drop_newest"],
          description: "Behavior when buffer full (default: block)",
          default: "block",
        },
      },
      description: "Buffer configuration",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Request                                                            */
/* ------------------------------------------------------------------ */

export function requestSchema() {
  return {
    request: {
      type: "object",
      properties: {
        timeout_secs: {
          type: "number",
          description: "Request timeout in seconds (default: 60)",
          default: 60,
        },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Additional request headers (key-value pairs)",
        },
        concurrency: {
          type: "string",
          description:
            "Concurrency: adaptive, none, or integer (default: adaptive)",
          default: "adaptive",
        },
        retry_attempts: {
          type: "number",
          description: "Max retry attempts",
        },
        retry_initial_backoff_secs: {
          type: "number",
          description:
            "Initial backoff in seconds before first retry (default: 1)",
          default: 1,
        },
        retry_max_duration_secs: {
          type: "number",
          description: "Max time between retries in seconds (default: 30)",
          default: 30,
        },
        rate_limit_duration_secs: {
          type: "number",
          description: "Rate limit window in seconds (default: 1)",
          default: 1,
        },
        rate_limit_num: {
          type: "number",
          description: "Max requests per rate limit window",
        },
      },
      description: "Request configuration",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Encoding                                                           */
/* ------------------------------------------------------------------ */

export function encodingSchema(
  codecs: string[] = [
    "avro",
    "cef",
    "csv",
    "gelf",
    "json",
    "logfmt",
    "native",
    "native_json",
    "otlp",
    "protobuf",
    "raw_message",
    "syslog",
    "text",
  ],
) {
  return {
    encoding: {
      type: "object",
      properties: {
        codec: {
          type: "string",
          enum: codecs,
          description: "Encoding format",
        },
        timestamp_format: {
          type: "string",
          enum: [
            "rfc3339",
            "unix",
            "unix_float",
            "unix_ms",
            "unix_ns",
            "unix_us",
          ],
          description: "Timestamp format",
        },
      },
      description: "Encoding configuration",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Decoding                                                           */
/* ------------------------------------------------------------------ */

export function decodingSchema(
  codecs: string[] = [
    "bytes",
    "json",
    "syslog",
    "gelf",
    "influxdb",
    "native",
    "native_json",
    "avro",
    "protobuf",
    "vrl",
  ],
) {
  return {
    decoding: {
      type: "object",
      properties: {
        codec: {
          type: "string",
          enum: codecs,
          description: "Decoding codec (default: bytes)",
          default: "bytes",
        },
      },
      description: "Decoding configuration",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Compression                                                        */
/* ------------------------------------------------------------------ */

export function compressionSchema(
  algos: string[] = ["none", "gzip", "snappy", "zlib", "zstd"],
  defaultAlgo = "none",
) {
  return {
    compression: {
      type: "string",
      enum: algos,
      description: `Compression algorithm (default: ${defaultAlgo})`,
      default: defaultAlgo,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Auth: Basic + Bearer                                               */
/* ------------------------------------------------------------------ */

export function authBasicBearerSchema() {
  return {
    auth: {
      type: "object",
      properties: {
        strategy: {
          type: "string",
          enum: ["basic", "bearer"],
          description: "Authentication strategy",
        },
        user: {
          type: "string",
          description: "Basic auth username",
          dependsOn: { field: "strategy", value: "basic" },
        },
        password: {
          type: "string",
          description: "Basic auth password",
          sensitive: true,
          dependsOn: { field: "strategy", value: "basic" },
        },
        token: {
          type: "string",
          description: "Bearer token value",
          sensitive: true,
          dependsOn: { field: "strategy", value: "bearer" },
        },
      },
      description: "Authentication configuration",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Auth: HTTP Server (basic + custom — server-mode validation)        */
/* ------------------------------------------------------------------ */

/**
 * Auth schema for Vector's http_server source.
 *
 * Server-mode auth validates *incoming* requests, so the field names and
 * strategies differ from the outbound (client-mode) auth used by sinks:
 *   - `username` / `password` for basic (not `user`)
 *   - `source` (VRL expression) for custom
 *   - No bearer support
 */
export function authHttpServerSchema() {
  return {
    auth: {
      type: "object",
      properties: {
        strategy: {
          type: "string",
          enum: ["basic", "custom"],
          description: "Authentication strategy",
        },
        username: {
          type: "string",
          description: "Basic auth username",
          dependsOn: { field: "strategy", value: "basic" },
        },
        password: {
          type: "string",
          description: "Basic auth password",
          sensitive: true,
          dependsOn: { field: "strategy", value: "basic" },
        },
        source: {
          type: "string",
          description: "VRL boolean expression for custom auth validation",
          dependsOn: { field: "strategy", value: "custom" },
        },
      },
      description: "Authentication configuration (optional — omit for no auth)",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Auth: AWS                                                          */
/* ------------------------------------------------------------------ */

export function authAwsSchema() {
  return {
    auth: {
      type: "object",
      properties: {
        access_key_id: {
          type: "string",
          description: "AWS access key ID",
        },
        secret_access_key: {
          type: "string",
          description: "AWS secret access key",
          sensitive: true,
        },
        session_token: {
          type: "string",
          description: "AWS temporary session token",
          sensitive: true,
        },
        assume_role: {
          type: "string",
          description: "IAM role ARN to assume",
        },
        region: {
          type: "string",
          description: "AWS region for STS requests",
        },
        profile: {
          type: "string",
          description: "Named credential profile (default: default)",
        },
      },
      description: "AWS authentication configuration",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Auth: Elasticsearch-style (basic + aws with dependsOn)             */
/* ------------------------------------------------------------------ */

export function authElasticsearchSchema() {
  return {
    auth: {
      type: "object",
      properties: {
        strategy: {
          type: "string",
          enum: ["basic", "aws"],
          description: "Authentication strategy",
        },
        user: {
          type: "string",
          description: "Basic auth username",
          dependsOn: { field: "strategy", value: "basic" },
        },
        password: {
          type: "string",
          description: "Basic auth password",
          sensitive: true,
          dependsOn: { field: "strategy", value: "basic" },
        },
        access_key_id: {
          type: "string",
          description: "AWS access key ID",
          dependsOn: { field: "strategy", value: "aws" },
        },
        secret_access_key: {
          type: "string",
          description: "AWS secret access key",
          sensitive: true,
          dependsOn: { field: "strategy", value: "aws" },
        },
        assume_role: {
          type: "string",
          description: "IAM role ARN to assume",
          dependsOn: { field: "strategy", value: "aws" },
        },
        region: {
          type: "string",
          description: "AWS region for STS requests",
          dependsOn: { field: "strategy", value: "aws" },
        },
      },
      description: "Authentication configuration",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Kafka SASL auth                                                    */
/* ------------------------------------------------------------------ */

export function kafkaSaslSchema() {
  return {
    sasl: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "Enable SASL authentication" },
        mechanism: {
          type: "string",
          enum: ["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"],
          description: "SASL mechanism",
        },
        username: { type: "string", description: "SASL username" },
        password: {
          type: "string",
          description: "SASL password",
          sensitive: true,
        },
      },
      description: "SASL authentication configuration",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Datadog common fields                                              */
/* ------------------------------------------------------------------ */

export function datadogCommonSchema() {
  return {
    default_api_key: {
      type: "string",
      description:
        "The default Datadog API key to use in authentication of HTTP requests. Can be overridden by event-level metadata.",
      sensitive: true,
    },
    endpoint: {
      type: "string",
      description:
        "The endpoint to send observability data to. Must contain an HTTP scheme. Overrides the site option if set.",
    },
    site: {
      type: "string",
      enum: [
        "datadoghq.com",
        "datadoghq.eu",
        "us3.datadoghq.com",
        "us5.datadoghq.com",
        "ddog-gov.com",
        "ap1.datadoghq.com",
      ],
      description:
        "The Datadog site to send observability data to. Can also be set via the DD_SITE environment variable. The config value takes precedence over the environment variable.",
      default: "datadoghq.com",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Framing (for sources that accept framed input)                     */
/* ------------------------------------------------------------------ */

export function framingSchema() {
  return {
    framing: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: [
            "bytes",
            "newline_delimited",
            "character_delimited",
            "chunked_gelf",
            "octet_counting",
            "length_delimited",
          ],
          description: "Framing method (default: bytes)",
          default: "bytes",
        },
        character_delimited: {
          type: "object",
          properties: {
            delimiter: {
              type: "string",
              description: "Delimiter character",
            },
          },
          description: "Character-delimited framing options",
        },
      },
      description: "Framing configuration",
    },
  };
}
