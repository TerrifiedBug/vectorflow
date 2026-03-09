import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  encodingSchema,
  compressionSchema,
  kafkaSaslSchema,
} from "../shared";

export const messagingSinks: VectorComponentDef[] = [
  {
    type: "kafka",
    kind: "sink",
    displayName: "Kafka",
    description: "Publish events to Apache Kafka topics",
    category: "Messaging",
    inputTypes: ["log", "metric"],
    outputTypes: ["log", "metric"],
    icon: "Radio",
    configSchema: {
      type: "object",
      properties: {
        bootstrap_servers: {
          type: "string",
          description: "Comma-separated list of host:port broker addresses",
        },
        topic: {
          type: "string",
          description: "Kafka topic to publish to (template-enabled)",
        },
        key_field: {
          type: "string",
          description: "Field to use as the message key",
        },
        headers_key: {
          type: "string",
          description: "Field containing message headers",
        },
        librdkafka_options: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Advanced librdkafka client options as key-value pairs",
        },
        message_timeout_ms: {
          type: "number",
          description:
            "Local message timeout in milliseconds (default: 300000)",
          default: 300000,
        },
        socket_timeout_ms: {
          type: "number",
          description:
            "Default timeout for network requests in milliseconds (default: 60000)",
          default: 60000,
        },
        ...kafkaSaslSchema(),
        ...encodingSchema([
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
        ]),
        ...compressionSchema(["none", "gzip", "snappy", "lz4", "zstd"], "none"),
        ...tlsSchema(),
        ...bufferSchema(),
      },
      required: ["bootstrap_servers", "topic", "encoding"],
    },
  },
  {
    type: "amqp",
    kind: "sink",
    displayName: "AMQP",
    description: "Publish events to an AMQP 0.9.1 broker (RabbitMQ)",
    category: "Messaging",
    status: "beta",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "MessageSquare",
    configSchema: {
      type: "object",
      properties: {
        connection_string: {
          type: "string",
          description:
            "AMQP connection URI (e.g., amqp://user:password@127.0.0.1:5672/%2f?timeout=10)",
        },
        exchange: {
          type: "string",
          description: "Exchange name to publish to (template-enabled)",
        },
        routing_key: {
          type: "string",
          description: "Routing key for queue binding (template-enabled)",
        },
        max_channels: {
          type: "number",
          description:
            "Maximum number of AMQP channels to keep active (default: 4)",
          default: 4,
        },
        properties: {
          type: "object",
          properties: {
            content_type: {
              type: "string",
              description: "Content-Type for the AMQP messages",
            },
            content_encoding: {
              type: "string",
              description: "Content-Encoding for the AMQP messages",
            },
            expiration_ms: {
              type: "number",
              description: "Expiration for AMQP messages (in milliseconds)",
            },
            priority: {
              type: "string",
              description:
                "Priority for AMQP messages (template-enabled, integer 0-255)",
            },
          },
          description: "AMQP message properties",
        },
        ...encodingSchema([
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
        ]),
        ...tlsSchema(),
        ...bufferSchema(),
      },
      required: ["connection_string", "exchange", "encoding"],
    },
  },
  {
    type: "pulsar",
    kind: "sink",
    displayName: "Pulsar",
    description: "Publish events to Apache Pulsar topics",
    category: "Messaging",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "MessageSquare",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description:
            "Pulsar service URL (e.g., pulsar://127.0.0.1:6650)",
        },
        topic: {
          type: "string",
          description: "Pulsar topic to publish to (template-enabled)",
        },
        producer_name: {
          type: "string",
          description:
            "Name of the producer; if not specified, Pulsar assigns a default",
        },
        partition_key_field: {
          type: "string",
          description:
            "Log field name or tags key to use as the partition key",
        },
        properties_key: {
          type: "string",
          description:
            "Log field name to use for the Pulsar properties key",
        },
        compression: {
          type: "string",
          enum: ["none", "lz4", "gzip", "zstd", "snappy"],
          description: "Message compression codec (default: none)",
          default: "none",
        },
        auth: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Authentication provider name (e.g., token, oauth2)",
            },
            token: {
              type: "string",
              description: "Authentication token",
              sensitive: true,
            },
            oauth2: {
              type: "object",
              properties: {
                audience: {
                  type: "string",
                  description: "OAuth2 audience",
                },
                credentials_url: {
                  type: "string",
                  description: "URL to fetch OAuth2 credentials from",
                },
                issuer_url: {
                  type: "string",
                  description: "OAuth2 issuer URL",
                },
                scope: {
                  type: "string",
                  description: "OAuth2 scope",
                },
              },
              description: "OAuth2 authentication configuration",
            },
          },
          description: "Authentication configuration",
        },
        ...encodingSchema([
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
        ]),
        ...tlsSchema(),
        ...bufferSchema(),
      },
      required: ["endpoint", "topic", "encoding"],
    },
  },
  {
    type: "redis",
    kind: "sink",
    displayName: "Redis",
    description: "Send events to Redis lists, channels, or sorted sets",
    category: "Messaging",
    status: "beta",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Database",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description:
            "Redis connection URL (e.g., redis://127.0.0.1:6379/0)",
        },
        data_type: {
          type: "string",
          enum: ["list", "channel", "sortedset"],
          description: "Redis data type to store messages in (default: list)",
          default: "list",
        },
        key: {
          type: "string",
          description:
            "Redis key (list name, channel name, or template-enabled)",
        },
        list_option: {
          type: "object",
          properties: {
            method: {
              type: "string",
              enum: ["lpush", "rpush"],
              description: "List push method (default: rpush)",
              default: "rpush",
            },
          },
          description: "List-specific configuration",
        },
        sorted_set_option: {
          type: "object",
          properties: {
            method: {
              type: "string",
              enum: ["zadd"],
              description:
                "Sorted set push method (default: zadd)",
              default: "zadd",
            },
            score: {
              type: "string",
              description:
                "Score to publish a message with (template-enabled)",
            },
          },
          description: "Sorted set-specific configuration",
        },
        ...encodingSchema([
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
        ]),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "key", "encoding"],
    },
  },
  {
    type: "nats",
    kind: "sink",
    displayName: "NATS",
    description: "Publish events to NATS subjects",
    category: "Messaging",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "MessageSquare",
    configSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "NATS server URL (e.g., nats://127.0.0.1:4222). Supports comma-separated multiple URLs",
        },
        subject: {
          type: "string",
          description: "NATS subject to publish to (template-enabled)",
        },
        connection_name: {
          type: "string",
          description: "Name for the NATS connection",
        },
        auth: {
          type: "object",
          properties: {
            strategy: {
              type: "string",
              enum: [
                "credentials_file",
                "nkey",
                "token",
                "user_password",
              ],
              description: "Authentication strategy",
            },
            credentials_file: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "Path to NATS credentials file",
                },
              },
              description: "Credentials file authentication",
              dependsOn: { field: "strategy", value: "credentials_file" },
            },
            nkey: {
              type: "object",
              properties: {
                nkey: {
                  type: "string",
                  description: "NKey public key",
                },
                seed: {
                  type: "string",
                  description: "NKey private key seed",
                  sensitive: true,
                },
              },
              description: "NKey authentication",
              dependsOn: { field: "strategy", value: "nkey" },
            },
            token: {
              type: "string",
              description: "Token for authentication",
              sensitive: true,
              dependsOn: { field: "strategy", value: "token" },
            },
            user_password: {
              type: "object",
              properties: {
                user: {
                  type: "string",
                  description: "Username",
                },
                password: {
                  type: "string",
                  description: "Password",
                  sensitive: true,
                },
              },
              description: "User/password authentication",
              dependsOn: { field: "strategy", value: "user_password" },
            },
          },
          description: "Authentication configuration",
        },
        ...encodingSchema([
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
        ]),
        ...tlsSchema(),
        ...bufferSchema(),
      },
      required: ["url", "subject", "encoding"],
    },
  },
  {
    type: "mqtt",
    kind: "sink",
    displayName: "MQTT",
    description: "Publish events to an MQTT broker",
    category: "Messaging",
    status: "beta",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "MessageSquare",
    configSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "MQTT broker hostname or IP address",
        },
        port: {
          type: "number",
          description: "MQTT broker port (default: 1883)",
          default: 1883,
        },
        topic: {
          type: "string",
          description: "MQTT topic to publish to (template-enabled)",
        },
        client_id: {
          type: "string",
          description: "MQTT client identifier",
        },
        clean_session: {
          type: "boolean",
          description:
            "If true, the MQTT session is cleaned on login (default: false)",
          default: false,
        },
        quality_of_service: {
          type: "string",
          enum: ["atmostonce", "atleastonce", "exactlyonce"],
          description:
            "Quality of Service level (default: atleastonce)",
          default: "atleastonce",
        },
        retain: {
          type: "boolean",
          description: "Set retain flag on messages (default: false)",
          default: false,
        },
        keep_alive: {
          type: "number",
          description:
            "Keep-alive interval in seconds between client and broker (default: 60)",
          default: 60,
        },
        max_packet_size: {
          type: "number",
          description:
            "Maximum allowed packet size in bytes (default: 10240)",
          default: 10240,
        },
        user: {
          type: "string",
          description: "MQTT username",
        },
        password: {
          type: "string",
          description: "MQTT password",
          sensitive: true,
        },
        ...encodingSchema([
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
        ]),
        ...tlsSchema(),
        ...bufferSchema(),
      },
      required: ["host", "topic", "encoding"],
    },
  },
];
