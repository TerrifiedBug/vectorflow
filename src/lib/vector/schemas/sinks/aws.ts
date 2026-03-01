import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  encodingSchema,
  compressionSchema,
  authAwsSchema,
} from "../shared";

export const awsSinks: VectorComponentDef[] = [
  {
    type: "aws_s3",
    kind: "sink",
    displayName: "AWS S3",
    description: "Archive events to Amazon S3 buckets",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        bucket: {
          type: "string",
          description: "S3 bucket name",
        },
        key_prefix: {
          type: "string",
          description: "S3 object key prefix template",
          default: "date=%F",
        },
        region: {
          type: "string",
          description: "AWS region of the bucket",
        },
        endpoint: {
          type: "string",
          description: "Custom S3-compatible endpoint URL",
        },
        storage_class: {
          type: "string",
          enum: [
            "STANDARD",
            "STANDARD_IA",
            "INTELLIGENT_TIERING",
            "ONEZONE_IA",
            "GLACIER",
            "GLACIER_IR",
            "DEEP_ARCHIVE",
            "EXPRESS_ONEZONE",
            "REDUCED_REDUNDANCY",
          ],
          description: "S3 storage class",
          default: "STANDARD",
        },
        server_side_encryption: {
          type: "string",
          enum: ["AES256", "aws:kms"],
          description: "Server-side encryption algorithm",
        },
        ssekms_key_id: {
          type: "string",
          description: "KMS key ID (requires aws:kms encryption)",
        },
        acl: {
          type: "string",
          enum: [
            "private",
            "public-read",
            "public-read-write",
            "authenticated-read",
            "aws-exec-read",
            "bucket-owner-read",
            "bucket-owner-full-control",
            "log-delivery-write",
          ],
          description: "Canned ACL for objects",
        },
        content_type: {
          type: "string",
          description: "MIME type override for objects",
        },
        content_encoding: {
          type: "string",
          description: "Override Content-Encoding header for objects",
        },
        force_path_style: {
          type: "boolean",
          description: "Force path-style S3 URLs",
        },
        filename_append_uuid: {
          type: "boolean",
          description: "Append UUID to filename",
          default: true,
        },
        filename_time_format: {
          type: "string",
          description: "Time format for filename",
          default: "%s",
        },
        filename_extension: {
          type: "string",
          description: "File extension for objects",
        },
        grant_full_control: {
          type: "string",
          description: "Grant full control permissions",
        },
        grant_read: {
          type: "string",
          description: "Grant read permissions",
        },
        grant_read_acp: {
          type: "string",
          description: "Grant read ACL permissions",
        },
        grant_write_acp: {
          type: "string",
          description: "Grant write ACL permissions",
        },
        tags: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Key-value pairs applied as tags to S3 objects",
        },
        timezone: {
          type: "string",
          description: "Timezone for date specifiers in templates (default: UTC)",
        },
        ...encodingSchema(["avro", "cef", "csv", "gelf", "json", "logfmt", "native", "native_json", "protobuf", "raw_message", "text"]),
        ...compressionSchema(["none", "gzip"], "gzip"),
        ...authAwsSchema(),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "300" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["bucket"],
    },
  },
  {
    type: "aws_cloudwatch_logs",
    kind: "sink",
    displayName: "AWS CloudWatch Logs",
    description: "Send log events to Amazon CloudWatch Logs",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        group_name: {
          type: "string",
          description: "CloudWatch log group name (template-enabled)",
        },
        stream_name: {
          type: "string",
          description: "CloudWatch log stream name (template-enabled)",
        },
        region: {
          type: "string",
          description: "AWS region",
        },
        endpoint: {
          type: "string",
          description: "Custom endpoint for use with AWS-compatible services",
        },
        create_missing_group: {
          type: "boolean",
          description: "Create log group if missing",
          default: true,
        },
        create_missing_stream: {
          type: "boolean",
          description: "Create log stream if missing",
          default: true,
        },
        retention: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
              description: "Whether to set a retention policy when creating a new log group",
              default: false,
            },
            days: {
              type: "number",
              description: "Number of days to retain logs for",
            },
          },
          description: "Log group retention configuration",
        },
        kms_key: {
          type: "string",
          description: "KMS key ARN for encrypting logs",
        },
        ...encodingSchema(["avro", "cef", "csv", "gelf", "json", "logfmt", "native", "native_json", "protobuf", "raw_message", "text"]),
        ...compressionSchema(["none", "gzip"], "none"),
        ...authAwsSchema(),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["group_name", "stream_name"],
    },
  },
  {
    type: "aws_cloudwatch_metrics",
    kind: "sink",
    displayName: "AWS CloudWatch Metrics",
    description: "Send metric events to Amazon CloudWatch Metrics",
    category: "Cloud",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        default_namespace: {
          type: "string",
          description: "Default CloudWatch namespace for metrics",
        },
        region: {
          type: "string",
          description: "AWS region",
        },
        endpoint: {
          type: "string",
          description: "Custom endpoint for use with AWS-compatible services",
        },
        ...compressionSchema(["none", "gzip"], "none"),
        ...authAwsSchema(),
        ...tlsSchema(),
        ...batchSchema({ timeout_secs: "1" }),
        ...bufferSchema(),
      },
      required: ["default_namespace"],
    },
  },
  {
    type: "aws_kinesis_firehose",
    kind: "sink",
    displayName: "AWS Kinesis Firehose",
    description: "Send events to Amazon Kinesis Data Firehose",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        stream_name: {
          type: "string",
          description: "Firehose delivery stream name",
        },
        region: {
          type: "string",
          description: "AWS region",
        },
        endpoint: {
          type: "string",
          description: "Custom endpoint for use with AWS-compatible services",
        },
        partition_key_field: {
          type: "string",
          description: "Log field to use as the partition key for Kinesis records",
        },
        ...encodingSchema(["avro", "cef", "csv", "gelf", "json", "logfmt", "native", "native_json", "protobuf", "raw_message", "text"]),
        ...compressionSchema(["none", "gzip"], "none"),
        ...authAwsSchema(),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "4MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["stream_name"],
    },
  },
  {
    type: "aws_kinesis_streams",
    kind: "sink",
    displayName: "AWS Kinesis Streams",
    description: "Send events to Amazon Kinesis Data Streams",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        stream_name: {
          type: "string",
          description: "Kinesis stream name",
        },
        partition_key_field: {
          type: "string",
          description: "Field to use as the partition key",
        },
        region: {
          type: "string",
          description: "AWS region",
        },
        endpoint: {
          type: "string",
          description: "Custom endpoint for use with AWS-compatible services",
        },
        ...encodingSchema(["avro", "cef", "csv", "gelf", "json", "logfmt", "native", "native_json", "protobuf", "raw_message", "text"]),
        ...compressionSchema(["none", "gzip"], "none"),
        ...authAwsSchema(),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "5MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["stream_name"],
    },
  },
  {
    type: "aws_sqs",
    kind: "sink",
    displayName: "AWS SQS",
    description: "Send events to Amazon SQS queues",
    category: "Cloud",
    inputTypes: ["log"],
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
        endpoint: {
          type: "string",
          description: "Custom endpoint for use with AWS-compatible services",
        },
        message_group_id: {
          type: "string",
          description: "Message group ID for FIFO queues (template-enabled)",
        },
        message_deduplication_id: {
          type: "string",
          description: "Deduplication ID for FIFO queues (template-enabled)",
        },
        ...encodingSchema(["avro", "cef", "csv", "gelf", "json", "logfmt", "native", "native_json", "protobuf", "raw_message", "text"]),
        ...authAwsSchema(),
        ...tlsSchema(),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["queue_url"],
    },
  },
  {
    type: "aws_sns",
    kind: "sink",
    displayName: "AWS SNS",
    description: "Publish events to Amazon SNS topics",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        queue_url: {
          type: "string",
          description: "SQS queue URL for SNS publishing",
        },
        region: {
          type: "string",
          description: "AWS region",
        },
        endpoint: {
          type: "string",
          description: "Custom endpoint for use with AWS-compatible services",
        },
        message_group_id: {
          type: "string",
          description: "Message group ID for FIFO queues (template-enabled)",
        },
        message_deduplication_id: {
          type: "string",
          description: "Deduplication ID for FIFO queues (template-enabled)",
        },
        ...encodingSchema(["avro", "cef", "csv", "gelf", "json", "logfmt", "native", "native_json", "protobuf", "raw_message", "text"]),
        ...authAwsSchema(),
        ...tlsSchema(),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["queue_url"],
    },
  },
];
