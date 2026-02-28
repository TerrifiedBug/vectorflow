import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  encodingSchema,
  compressionSchema,
  kafkaSaslSchema,
  authBasicBearerSchema,
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
        ...kafkaSaslSchema(),
        ...encodingSchema(["json", "text", "raw_message", "avro"]),
        ...compressionSchema(["none", "gzip", "snappy", "lz4", "zstd"], "none"),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
      },
      required: ["bootstrap_servers", "topic"],
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
        connection: {
          type: "string",
          description: "AMQP connection URL (e.g., amqp://guest:guest@localhost:5672/%2f)",
        },
        exchange: {
          type: "string",
          description: "Exchange name to publish to",
        },
        exchange_type: {
          type: "string",
          enum: ["direct", "fanout", "topic", "headers"],
          description: "Exchange type",
        },
        routing_key: {
          type: "string",
          description: "Routing key (template-enabled)",
        },
        properties: {
          type: "object",
          properties: {
            content_type: {
              type: "string",
              description: "AMQP message content type",
            },
            content_encoding: {
              type: "string",
              description: "AMQP message content encoding",
            },
          },
          description: "AMQP message properties",
        },
        ...encodingSchema(["json", "text", "raw_message"]),
        ...tlsSchema(),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["connection", "exchange"],
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
          description: "Pulsar service URL (default: pulsar://127.0.0.1:6650)",
        },
        topic: {
          type: "string",
          description: "Pulsar topic to publish to",
        },
        producer_name: {
          type: "string",
          description: "Pulsar producer name",
        },
        partition_key_field: {
          type: "string",
          description: "Field to use as the partition key",
        },
        compression: {
          type: "string",
          enum: ["none", "lz4", "zlib", "zstd", "snappy"],
          description: "Message compression (default: none)",
        },
        ...authBasicBearerSchema(),
        ...encodingSchema(["json", "text", "raw_message", "avro"]),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "5MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "topic"],
    },
  },
  {
    type: "redis",
    kind: "sink",
    displayName: "Redis",
    description: "Send events to Redis lists, channels, or streams",
    category: "Messaging",
    status: "beta",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Database",
    configSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Redis connection URL (default: redis://127.0.0.1:6379/0)",
        },
        data_type: {
          type: "string",
          enum: ["list", "channel"],
          description: "Redis data type to write to",
        },
        key: {
          type: "string",
          description: "Redis key (list name, channel name, or template)",
        },
        list: {
          type: "object",
          properties: {
            method: {
              type: "string",
              enum: ["lpush", "rpush"],
              description: "List push method (default: rpush)",
            },
          },
          description: "List-specific configuration",
        },
        ...encodingSchema(["json", "text", "raw_message"]),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["url", "data_type", "key"],
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
          description: "NATS server URL (default: nats://127.0.0.1:4222)",
        },
        subject: {
          type: "string",
          description: "NATS subject to publish to (template-enabled)",
        },
        connection_name: {
          type: "string",
          description: "Name for the NATS connection",
        },
        ...authBasicBearerSchema(),
        ...encodingSchema(["json", "text", "raw_message"]),
        ...tlsSchema(),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["url", "subject"],
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
          description: "MQTT broker host",
        },
        port: {
          type: "number",
          description: "MQTT broker port (default: 1883)",
        },
        topic: {
          type: "string",
          description: "MQTT topic to publish to (template-enabled)",
        },
        client_id: {
          type: "string",
          description: "MQTT client identifier",
        },
        qos: {
          type: "number",
          description: "Quality of Service level (0, 1, or 2)",
        },
        retain: {
          type: "boolean",
          description: "Set retain flag on messages (default: false)",
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
        ...encodingSchema(["json", "text", "raw_message"]),
        ...tlsSchema(),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["host", "topic"],
    },
  },
];
