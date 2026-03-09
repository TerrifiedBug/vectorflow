import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  encodingSchema,
  compressionSchema,
} from "../shared";

function gcpAuthSchema() {
  return {
    credentials_path: {
      type: "string",
      description: "Path to GCP service account JSON key file",
    },
    api_key: {
      type: "string",
      description: "GCP API key",
      sensitive: true,
    },
  };
}

export const gcpSinks: VectorComponentDef[] = [
  {
    type: "gcp_cloud_storage",
    kind: "sink",
    displayName: "GCP Cloud Storage",
    description: "Archive events to Google Cloud Storage buckets",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        bucket: {
          type: "string",
          description: "GCS bucket name",
        },
        key_prefix: {
          type: "string",
          description:
            "A prefix to apply to all object keys. Supports template syntax.",
          default: "date=%F/",
        },
        acl: {
          type: "string",
          enum: [
            "authenticated-read",
            "bucket-owner-full-control",
            "bucket-owner-read",
            "private",
            "project-private",
            "public-read",
          ],
          description: "Predefined ACL to apply to created objects",
        },
        storage_class: {
          type: "string",
          enum: ["STANDARD", "NEARLINE", "COLDLINE", "ARCHIVE"],
          description: "Storage class for created objects",
        },
        metadata: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Custom metadata key-value pairs for created objects",
        },
        content_type: {
          type: "string",
          description: "Content-Type override for objects",
        },
        endpoint: {
          type: "string",
          description: "API endpoint for Google Cloud Storage",
          default: "https://storage.googleapis.com",
        },
        filename_append_uuid: {
          type: "boolean",
          description:
            "Whether to append a UUID v4 token to the end of the object key",
          default: true,
        },
        filename_time_format: {
          type: "string",
          description:
            "Timestamp format for the time component of the object key (strftime specifiers)",
          default: "%s",
        },
        filename_extension: {
          type: "string",
          description:
            "Filename extension for the object key. If not specified, determined by compression scheme.",
        },
        timezone: {
          type: "string",
          description:
            "Timezone for date specifiers in template strings (TZ database name or 'local')",
        },
        ...gcpAuthSchema(),
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
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "none",
        ),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "300" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["bucket", "encoding"],
    },
  },
  {
    type: "gcp_stackdriver_logs",
    kind: "sink",
    displayName: "GCP Cloud Logging",
    description: "Send log events to Google Cloud Logging (Stackdriver)",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description:
            "GCP project ID. Exactly one of billing_account_id, folder_id, organization_id, or project_id must be set.",
        },
        log_id: {
          type: "string",
          description:
            "The log ID to which to publish logs. Supports template syntax.",
        },
        billing_account_id: {
          type: "string",
          description:
            "Billing account ID to which to publish logs (alternative to project_id)",
        },
        folder_id: {
          type: "string",
          description:
            "Folder ID to which to publish logs (alternative to project_id)",
        },
        organization_id: {
          type: "string",
          description:
            "Organization ID to which to publish logs (alternative to project_id)",
        },
        resource: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description:
                "Monitored resource type (e.g. global, gce_instance, k8s_container)",
            },
          },
          additionalProperties: { type: "string" },
          description:
            "Google Cloud monitored resource descriptor with type and label values",
        },
        severity_key: {
          type: "string",
          description:
            "Field from the log event to use as the outgoing log severity",
        },
        labels: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Key-value pairs providing additional information about the log entry. Supports template syntax.",
        },
        labels_key: {
          type: "string",
          description:
            "Field used to retrieve associated labels from the jsonPayload",
          default: "logging.googleapis.com/labels",
        },
        encoding: {
          type: "object",
          properties: {
            except_fields: {
              type: "array",
              items: { type: "string" },
              description: "List of fields to exclude from the encoded event",
            },
            only_fields: {
              type: "array",
              items: { type: "string" },
              description: "List of fields to include in the encoded event",
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
              description: "Format used for timestamp fields",
            },
          },
          description: "Transformations to prepare an event for serialization",
        },
        ...gcpAuthSchema(),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["log_id", "resource"],
    },
  },
  {
    type: "gcp_stackdriver_metrics",
    kind: "sink",
    displayName: "GCP Cloud Monitoring",
    description: "Send metrics to Google Cloud Monitoring (Stackdriver)",
    category: "Cloud",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "GCP project ID to which to publish metrics",
        },
        default_namespace: {
          type: "string",
          description:
            "Default namespace for metrics that do not have one",
          default: "namespace",
        },
        resource: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description:
                "Monitored resource type (e.g. global, gce_instance)",
            },
          },
          additionalProperties: { type: "string" },
          description:
            "Google Cloud monitored resource descriptor with type and label values",
        },
        ...gcpAuthSchema(),
        ...tlsSchema(),
        ...batchSchema({ timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["project_id", "resource"],
    },
  },
  {
    type: "gcp_pubsub",
    kind: "sink",
    displayName: "GCP Pub/Sub",
    description: "Publish events to Google Cloud Pub/Sub topics",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "GCP project name",
        },
        topic: {
          type: "string",
          description: "Pub/Sub topic name within the project",
        },
        endpoint: {
          type: "string",
          description:
            "Endpoint to which to publish events. Must include the scheme, no path or trailing slash.",
          default: "https://pubsub.googleapis.com",
        },
        ...gcpAuthSchema(),
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
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["project", "topic", "encoding"],
    },
  },
  {
    type: "gcp_chronicle_unstructured",
    kind: "sink",
    displayName: "GCP Chronicle",
    description: "Send unstructured log events to Google Chronicle SIEM",
    category: "Cloud",
    status: "beta",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Shield",
    configSchema: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "Chronicle customer ID (UUID)",
        },
        log_type: {
          type: "string",
          description:
            "The type of log entries in a request. Must be a supported Chronicle log type. Supports template syntax.",
        },
        fallback_log_type: {
          type: "string",
          description:
            "Default log_type when the template in log_type cannot be resolved",
        },
        endpoint: {
          type: "string",
          description: "Chronicle API endpoint to send data to",
        },
        region: {
          type: "string",
          enum: [
            "us",
            "eu",
            "asia",
            "canada",
            "dammam",
            "doha",
            "frankfurt",
            "london",
            "mumbai",
            "paris",
            "singapore",
            "sydney",
            "são_paulo",
            "tel_aviv",
            "tokyo",
            "turin",
            "zurich",
          ],
          description: "GCP region for the Chronicle service",
        },
        namespace: {
          type: "string",
          description:
            "User-configured environment namespace to identify the data domain. Supports template syntax.",
        },
        labels: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Key-value pairs attached to each batch of events",
        },
        ...gcpAuthSchema(),
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
        ...compressionSchema(["gzip", "none", "snappy", "zlib", "zstd"], "none"),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "15" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["customer_id", "log_type", "encoding"],
    },
  },
];
