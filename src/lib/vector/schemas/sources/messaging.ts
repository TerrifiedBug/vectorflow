import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  decodingSchema,
  kafkaSaslSchema,
  authAwsSchema,
  authBasicBearerSchema,
} from "../shared";

export const messagingSources: VectorComponentDef[] = [
  {
    type: "kafka",
    kind: "source",
    displayName: "Kafka",
    description: "Consume events from Apache Kafka topics",
    category: "Messaging",
    outputTypes: ["log"],
    icon: "Radio",
    configSchema: {
      type: "object",
      properties: {
        bootstrap_servers: {
          type: "string",
          description: "Comma-separated list of host:port broker addresses",
        },
        group_id: {
          type: "string",
          description: "Consumer group name",
        },
        topics: {
          type: "array",
          items: { type: "string" },
          description:
            "Topic names to consume from (regex supported with ^ prefix)",
        },
        auto_offset_reset: {
          type: "string",
          enum: [
            "smallest",
            "earliest",
            "beginning",
            "largest",
            "latest",
            "end",
          ],
          description: "Where to start reading when no offset exists",
        },
        commit_interval_ms: {
          type: "number",
          description:
            "Offset commit frequency in milliseconds (default: 5000)",
        },
        session_timeout_ms: {
          type: "number",
          description: "Session timeout in milliseconds (default: 10000)",
        },
        key_field: {
          type: "string",
          description:
            "Field name for the message key (default: message_key)",
        },
        ...kafkaSaslSchema(),
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["bootstrap_servers", "topics"],
    },
  },
  {
    type: "amqp",
    kind: "source",
    displayName: "AMQP",
    description: "Consume events from an AMQP 0.9.1 broker (RabbitMQ)",
    category: "Messaging",
    status: "beta",
    outputTypes: ["log"],
    icon: "MessageSquare",
    configSchema: {
      type: "object",
      properties: {
        connection: {
          type: "string",
          description: "AMQP connection URL (e.g., amqp://guest:guest@localhost:5672/%2f)",
        },
        group_id: {
          type: "string",
          description: "Consumer group identifier",
        },
        queue: {
          type: "string",
          description: "Queue name to consume from",
        },
        exchange: {
          type: "string",
          description: "Exchange name to bind to",
        },
        exchange_type: {
          type: "string",
          enum: ["direct", "fanout", "topic", "headers"],
          description: "Exchange type",
        },
        routing_key_field: {
          type: "string",
          description: "Field for the routing key (default: routing)",
        },
        consumer_tag: {
          type: "string",
          description: "Consumer tag for identification",
        },
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["connection"],
    },
  },
  {
    type: "nats",
    kind: "source",
    displayName: "NATS",
    description: "Consume events from NATS subjects",
    category: "Messaging",
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
          description: "NATS subject to subscribe to",
        },
        queue: {
          type: "string",
          description: "NATS queue group name",
        },
        connection_name: {
          type: "string",
          description: "Name for the NATS connection",
        },
        ...authBasicBearerSchema(),
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["url", "subject"],
    },
  },
  {
    type: "pulsar",
    kind: "source",
    displayName: "Pulsar",
    description: "Consume events from Apache Pulsar topics",
    category: "Messaging",
    outputTypes: ["log"],
    icon: "MessageSquare",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Pulsar service URL (default: pulsar://127.0.0.1:6650)",
        },
        topics: {
          type: "array",
          items: { type: "string" },
          description: "Topics to consume from",
        },
        consumer_name: {
          type: "string",
          description: "Pulsar consumer name",
        },
        subscription_name: {
          type: "string",
          description: "Subscription name",
        },
        priority_level: {
          type: "number",
          description: "Consumer priority level",
        },
        batch_size: {
          type: "number",
          description: "Number of messages per batch (default: 1000)",
        },
        dead_letter_queue_topic: {
          type: "string",
          description: "Topic for dead letter messages",
        },
        ...authBasicBearerSchema(),
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["endpoint", "topics"],
    },
  },
  {
    type: "mqtt",
    kind: "source",
    displayName: "MQTT",
    description: "Consume events from an MQTT broker",
    category: "Messaging",
    status: "beta",
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
          description: "MQTT topic to subscribe to",
        },
        client_id: {
          type: "string",
          description: "MQTT client identifier",
        },
        qos: {
          type: "number",
          description: "Quality of Service level (0, 1, or 2)",
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
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["host", "topic"],
    },
  },
  {
    type: "redis",
    kind: "source",
    displayName: "Redis",
    description: "Consume events from Redis lists, channels, or streams",
    category: "Messaging",
    status: "beta",
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
          description: "Redis data type to read from",
        },
        key: {
          type: "string",
          description: "Redis key (list name or channel name)",
        },
        list: {
          type: "object",
          properties: {
            method: {
              type: "string",
              enum: ["lpop", "rpop"],
              description: "List pop method (default: lpop)",
            },
          },
          description: "List-specific configuration",
        },
        redis_key: {
          type: "string",
          description: "Deprecated: use key instead",
        },
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["url", "data_type", "key"],
    },
  },
  {
    type: "gcp_pubsub",
    kind: "source",
    displayName: "GCP Pub/Sub",
    description: "Consume events from Google Cloud Pub/Sub subscriptions",
    category: "Messaging",
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "GCP project ID",
        },
        subscription: {
          type: "string",
          description: "Pub/Sub subscription name",
        },
        endpoint: {
          type: "string",
          description: "Custom Pub/Sub endpoint URL",
        },
        max_concurrency: {
          type: "number",
          description: "Max concurrent pull requests (default: 10)",
        },
        full_response_size: {
          type: "number",
          description: "Target total batch size in bytes",
        },
        ack_deadline_secs: {
          type: "number",
          description: "Acknowledgement deadline in seconds (default: 600)",
        },
        retry_delay_secs: {
          type: "number",
          description: "Delay between retries in seconds (default: 1)",
        },
        credentials_path: {
          type: "string",
          description: "Path to GCP service account JSON key file",
        },
        api_key: {
          type: "string",
          description: "GCP API key",
          sensitive: true,
        },
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["project", "subscription"],
    },
  },
  {
    type: "aws_sqs",
    kind: "source",
    displayName: "AWS SQS",
    description: "Consume events from Amazon SQS queues",
    category: "Messaging",
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        queue_url: {
          type: "string",
          description: "SQS queue URL",
        },
        region: {
          type: "string",
          description: "AWS region",
        },
        poll_secs: {
          type: "number",
          description: "Time to wait for messages in seconds (default: 15)",
        },
        max_number_of_messages: {
          type: "number",
          description: "Max messages per poll request (1-10, default: 10)",
        },
        visibility_timeout_secs: {
          type: "number",
          description: "Visibility timeout for received messages in seconds",
        },
        delete_message: {
          type: "boolean",
          description: "Delete messages after processing (default: true)",
        },
        client_concurrency: {
          type: "number",
          description: "Number of concurrent SQS clients (default: 1)",
        },
        ...authAwsSchema(),
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["queue_url"],
    },
  },
  {
    type: "aws_kinesis_firehose",
    kind: "source",
    displayName: "AWS Kinesis Firehose",
    description: "Receive events from AWS Kinesis Data Firehose HTTP endpoint",
    category: "Messaging",
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Address to listen on (default: 0.0.0.0:443)",
        },
        access_key: {
          type: "string",
          description: "Firehose access key for request validation",
          sensitive: true,
        },
        record_compression: {
          type: "string",
          enum: ["auto", "gzip", "none"],
          description: "Compression of incoming records (default: auto)",
        },
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["address"],
    },
  },
  {
    type: "aws_s3",
    kind: "source",
    displayName: "AWS S3",
    description: "Collect log events from files in S3 buckets via SQS notifications",
    category: "Messaging",
    status: "beta",
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        region: {
          type: "string",
          description: "AWS region",
        },
        sqs: {
          type: "object",
          properties: {
            queue_url: {
              type: "string",
              description: "SQS queue URL for S3 event notifications",
            },
            poll_secs: {
              type: "number",
              description: "Polling interval in seconds (default: 15)",
            },
            visibility_timeout_secs: {
              type: "number",
              description: "Message visibility timeout in seconds (default: 300)",
            },
            delete_message: {
              type: "boolean",
              description: "Delete SQS messages after processing (default: true)",
            },
          },
          description: "SQS notification queue configuration",
        },
        compression: {
          type: "string",
          enum: ["auto", "gzip", "zstd", "none"],
          description: "Object compression (default: auto)",
        },
        ...authAwsSchema(),
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: [],
    },
  },
  {
    type: "splunk_hec",
    kind: "source",
    displayName: "Splunk HEC",
    description: "Receive events via the Splunk HTTP Event Collector protocol",
    category: "Messaging",
    outputTypes: ["log"],
    icon: "Server",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Address to listen on (default: 0.0.0.0:8088)",
        },
        token: {
          type: "string",
          description: "HEC token for authentication",
          sensitive: true,
        },
        valid_tokens: {
          type: "array",
          items: { type: "string" },
          description: "List of valid HEC tokens (if multiple are accepted)",
        },
        store_hec_token: {
          type: "boolean",
          description: "Store the HEC token in the event (default: false)",
        },
        ...tlsSchema(),
      },
      required: ["address"],
    },
  },
  {
    type: "heroku_logs",
    kind: "source",
    displayName: "Heroku Logs",
    description: "Receive Heroku log drains via HTTPS",
    category: "Messaging",
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Address to listen on (default: 0.0.0.0:80)",
        },
        query_parameters: {
          type: "array",
          items: { type: "string" },
          description: "Query parameters to include as event fields",
        },
        ...tlsSchema(),
        ...decodingSchema(),
        ...authBasicBearerSchema(),
      },
      required: ["address"],
    },
  },
  {
    type: "datadog_agent",
    kind: "source",
    displayName: "Datadog Agent",
    description: "Receive observability data from Datadog Agents",
    category: "Messaging",
    outputTypes: ["log", "metric", "trace"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Address to listen on (default: 0.0.0.0:8282)",
        },
        multiple_outputs: {
          type: "boolean",
          description: "Separate outputs for logs, metrics, traces (default: false)",
        },
        disable_logs: {
          type: "boolean",
          description: "Disable log collection (default: false)",
        },
        disable_metrics: {
          type: "boolean",
          description: "Disable metric collection (default: false)",
        },
        disable_traces: {
          type: "boolean",
          description: "Disable trace collection (default: false)",
        },
        log_namespace: {
          type: "boolean",
          description: "Use Vector namespaced log schema (default: false)",
        },
        ...tlsSchema(),
      },
      required: [],
    },
  },
];

