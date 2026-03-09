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
            "error",
          ],
          description: "Where to start reading when no offset exists",
          default: "largest",
        },
        commit_interval_ms: {
          type: "number",
          description:
            "Offset commit frequency in milliseconds (default: 5000)",
          default: 5000,
        },
        session_timeout_ms: {
          type: "number",
          description: "Session timeout in milliseconds (default: 10000)",
          default: 10000,
        },
        socket_timeout_ms: {
          type: "number",
          description: "Socket timeout in milliseconds (default: 60000)",
          default: 60000,
        },
        fetch_wait_max_ms: {
          type: "number",
          description:
            "Maximum time the broker may wait to fill the response in milliseconds (default: 100)",
          default: 100,
        },
        drain_timeout_ms: {
          type: "number",
          description:
            "Timeout to drain pending acknowledgements during shutdown or rebalance in milliseconds",
        },
        key_field: {
          type: "string",
          description:
            "Field name for the message key (default: message_key)",
          default: "message_key",
        },
        topic_key: {
          type: "string",
          description: "Field name for the topic (default: topic)",
          default: "topic",
        },
        partition_key: {
          type: "string",
          description: "Field name for the partition (default: partition)",
          default: "partition",
        },
        offset_key: {
          type: "string",
          description: "Field name for the offset (default: offset)",
          default: "offset",
        },
        headers_key: {
          type: "string",
          description: "Field name for message headers (default: headers)",
          default: "headers",
        },
        ...kafkaSaslSchema(),
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["bootstrap_servers", "topics", "group_id"],
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
        connection_string: {
          type: "string",
          description: "AMQP connection URL (e.g., amqp://guest:guest@localhost:5672/%2f)",
        },
        consumer: {
          type: "string",
          description: "Consumer group identifier (default: vector)",
          default: "vector",
        },
        queue: {
          type: "string",
          description: "Queue name to consume from (default: vector)",
          default: "vector",
        },
        routing_key_field: {
          type: "string",
          description: "Field for the routing key (default: routing)",
          default: "routing",
        },
        exchange_key: {
          type: "string",
          description: "Field for the exchange name (default: exchange)",
          default: "exchange",
        },
        offset_key: {
          type: "string",
          description: "Field for the message offset (default: offset)",
          default: "offset",
        },
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["connection_string"],
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
          default: "nats://127.0.0.1:4222",
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
          description: "Name for the NATS connection (default: vector)",
          default: "vector",
        },
        subject_key_field: {
          type: "string",
          description: "Field name for the NATS subject in events",
        },
        subscriber_capacity: {
          type: "number",
          description:
            "Buffer capacity of the underlying NATS subscriber (default: 65536)",
          default: 65536,
        },
        ...authBasicBearerSchema(),
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["url", "subject", "connection_name"],
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
          default: "pulsar://127.0.0.1:6650",
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
          default: 1000,
        },
        auth: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Authentication provider name (e.g., token)",
            },
            token: {
              type: "string",
              description: "Authentication token",
              sensitive: true,
            },
            oauth2: {
              type: "object",
              properties: {
                issuer_url: {
                  type: "string",
                  description: "OAuth2 issuer URL",
                },
                credentials_url: {
                  type: "string",
                  description: "OAuth2 credentials URL",
                },
                audience: {
                  type: "string",
                  description: "OAuth2 audience",
                },
              },
              description: "OAuth2 authentication options",
            },
          },
          description: "Pulsar authentication configuration",
        },
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
          default: 1883,
        },
        topic: {
          type: "string",
          description: "MQTT topic to subscribe to (default: vector)",
          default: "vector",
        },
        client_id: {
          type: "string",
          description: "MQTT client identifier",
        },
        keep_alive: {
          type: "number",
          description: "Connection keep-alive interval in seconds (default: 60)",
          default: 60,
        },
        max_packet_size: {
          type: "number",
          description: "Maximum packet size in bytes (default: 10240)",
          default: 10240,
        },
        topic_key: {
          type: "string",
          description: "Field name for the topic in events (default: topic)",
          default: "topic",
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
      required: ["host"],
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
          description: "Redis data type to read from (default: list)",
          default: "list",
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
              description: "List pop method",
            },
          },
          description: "List-specific configuration",
        },
        redis_key: {
          type: "string",
          description: "Field name to add the Redis key to each event",
        },
        ...decodingSchema(),
      },
      required: ["url", "key"],
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
          description: "Max concurrent stream connections (default: 10)",
          default: 10,
        },
        full_response_size: {
          type: "number",
          description:
            "Number of messages in a response to mark a stream as busy (default: 100)",
          default: 100,
        },
        ack_deadline_secs: {
          type: "number",
          description: "Acknowledgement deadline in seconds (default: 600)",
          default: 600,
        },
        retry_delay_secs: {
          type: "number",
          description: "Delay between retries in seconds (default: 1)",
          default: 1,
        },
        keepalive_secs: {
          type: "number",
          description:
            "Keepalive interval in seconds for active streams (default: 60)",
          default: 60,
        },
        poll_time_seconds: {
          type: "number",
          description:
            "How often to poll active streams to check if they are busy (default: 2)",
          default: 2,
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
          default: 15,
        },
        visibility_timeout_secs: {
          type: "number",
          description:
            "Visibility timeout for received messages in seconds (default: 300)",
          default: 300,
        },
        delete_message: {
          type: "boolean",
          description: "Delete messages after processing (default: true)",
          default: true,
        },
        client_concurrency: {
          type: "number",
          description:
            "Number of concurrent tasks for polling the queue for messages",
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
          default: "0.0.0.0:443",
        },
        access_keys: {
          type: "array",
          items: { type: "string" },
          description: "List of valid Firehose access keys for request validation",
        },
        store_access_key: {
          type: "boolean",
          description:
            "Store the AWS Firehose access key in event secrets",
        },
        record_compression: {
          type: "string",
          enum: ["auto", "gzip", "none"],
          description: "Compression of incoming records (default: auto)",
          default: "auto",
        },
        ...tlsSchema(),
        ...decodingSchema(),
      },
      required: ["address", "store_access_key"],
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
              description: "Polling interval in seconds (default: 20)",
              default: 20,
            },
            visibility_timeout_secs: {
              type: "number",
              description: "Message visibility timeout in seconds",
            },
            delete_message: {
              type: "boolean",
              description: "Delete SQS messages after processing (default: true)",
              default: true,
            },
            max_number_of_messages: {
              type: "number",
              description:
                "Max messages to retrieve per poll (default: 10)",
              default: 10,
            },
            delete_failed_message: {
              type: "boolean",
              description:
                "Delete SQS messages that fail processing (default: false)",
              default: false,
            },
          },
          description: "SQS notification queue configuration",
        },
        compression: {
          type: "string",
          enum: ["auto", "gzip", "zstd", "none"],
          description: "Object compression (default: auto)",
          default: "auto",
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
          default: "0.0.0.0:8088",
        },
        valid_tokens: {
          type: "array",
          items: { type: "string" },
          description: "List of valid HEC tokens for authentication",
        },
        store_hec_token: {
          type: "boolean",
          description:
            "Forward the Splunk HEC authentication token with events (default: false)",
          default: false,
        },
        ...tlsSchema(),
      },
      required: [],
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
          description: "Address to listen on",
        },
        multiple_outputs: {
          type: "boolean",
          description: "Separate outputs for logs, metrics, traces (default: false)",
          default: false,
        },
        disable_logs: {
          type: "boolean",
          description: "Disable log collection (default: false)",
          default: false,
        },
        disable_metrics: {
          type: "boolean",
          description: "Disable metric collection (default: false)",
          default: false,
        },
        disable_traces: {
          type: "boolean",
          description: "Disable trace collection (default: false)",
          default: false,
        },
        store_api_key: {
          type: "boolean",
          description: "Store the Datadog API key in event metadata",
        },
        parse_ddtags: {
          type: "boolean",
          description: "Parse Datadog tags from incoming events",
        },
        ...tlsSchema(),
      },
      required: ["address"],
    },
  },
];

