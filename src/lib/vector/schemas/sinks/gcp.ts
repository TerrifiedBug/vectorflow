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
          description: "Object key prefix template (default: date=%F)",
        },
        acl: {
          type: "string",
          enum: [
            "authenticatedRead",
            "bucketOwnerFullControl",
            "bucketOwnerRead",
            "private",
            "projectPrivate",
            "publicRead",
          ],
          description: "Predefined ACL for objects",
        },
        storage_class: {
          type: "string",
          enum: ["STANDARD", "NEARLINE", "COLDLINE", "ARCHIVE"],
          description: "Storage class (default: STANDARD)",
        },
        metadata: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Custom metadata key-value pairs",
        },
        content_type: {
          type: "string",
          description: "Content-Type override for objects",
        },
        filename_append_uuid: {
          type: "boolean",
          description: "Append UUID to filename (default: true)",
        },
        filename_time_format: {
          type: "string",
          description: "Time format for filename (default: %s)",
        },
        filename_extension: {
          type: "string",
          description: "File extension (default: log)",
        },
        ...gcpAuthSchema(),
        ...encodingSchema(["json", "ndjson", "text", "csv", "raw_message"]),
        ...compressionSchema(["gzip", "none", "zlib", "zstd"], "none"),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "300" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["bucket"],
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
          description: "GCP project ID",
        },
        log_id: {
          type: "string",
          description: "Log ID (template-enabled, default: vector)",
        },
        billing_account_id: {
          type: "string",
          description: "Billing account ID (alternative to project)",
        },
        folder_id: {
          type: "string",
          description: "Folder ID (alternative to project)",
        },
        organization_id: {
          type: "string",
          description: "Organization ID (alternative to project)",
        },
        resource: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Monitored resource type (default: global)",
            },
          },
          description: "Google Cloud monitored resource descriptor",
        },
        severity_key: {
          type: "string",
          description: "Field to use as log severity",
        },
        ...gcpAuthSchema(),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "5MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["project_id"],
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
          description: "GCP project ID",
        },
        default_namespace: {
          type: "string",
          description: "Default metric namespace (default: custom.googleapis.com/vector)",
        },
        resource: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Monitored resource type (default: global)",
            },
          },
          description: "Google Cloud monitored resource descriptor",
        },
        ...gcpAuthSchema(),
        ...tlsSchema(),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["project_id"],
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
          description: "GCP project ID",
        },
        topic: {
          type: "string",
          description: "Pub/Sub topic name",
        },
        endpoint: {
          type: "string",
          description: "Custom Pub/Sub endpoint URL",
        },
        ...gcpAuthSchema(),
        ...encodingSchema(["json", "text", "raw_message"]),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["project", "topic"],
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
          description: "Chronicle customer ID",
        },
        log_type: {
          type: "string",
          description: "Chronicle log type",
        },
        endpoint: {
          type: "string",
          description: "Chronicle ingestion endpoint",
        },
        ...gcpAuthSchema(),
        ...encodingSchema(["json", "text", "raw_message"]),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "15" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["customer_id", "log_type"],
    },
  },
];
