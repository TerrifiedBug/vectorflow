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
        ca_file: { type: "string", description: "Path to CA certificate" },
        crt_file: { type: "string", description: "Path to client certificate" },
        key_file: { type: "string", description: "Path to private key" },
        key_pass: {
          type: "string",
          description: "Passphrase for encrypted key",
          sensitive: true,
        },
        verify_certificate: {
          type: "boolean",
          description: "Verify certificate validity",
        },
        verify_hostname: {
          type: "boolean",
          description: "Verify hostname in certificate",
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
        },
        max_events: {
          type: "number",
          description: "Max events in buffer (default: 500)",
        },
        when_full: {
          type: "string",
          enum: ["block", "drop_newest"],
          description: "Behavior when buffer full (default: block)",
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
        },
        concurrency: {
          type: "string",
          description:
            "Concurrency: adaptive, none, or integer (default: adaptive)",
        },
        retry_attempts: {
          type: "number",
          description: "Max retry attempts",
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
    "json",
    "ndjson",
    "text",
    "logfmt",
    "csv",
    "avro",
    "raw_message",
    "native_json",
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
          enum: ["rfc3339", "unix"],
          description: "Timestamp format (default: rfc3339)",
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
    "native_json",
    "avro",
    "protobuf",
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
      description: "Datadog API key",
      sensitive: true,
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
      description: "Datadog site",
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
            "octet_counting",
            "length_delimited",
          ],
          description: "Framing method (default: newline_delimited)",
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
