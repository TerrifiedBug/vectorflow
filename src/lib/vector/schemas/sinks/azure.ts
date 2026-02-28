import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  encodingSchema,
  compressionSchema,
} from "../shared";

export const azureSinks: VectorComponentDef[] = [
  {
    type: "azure_blob",
    kind: "sink",
    displayName: "Azure Blob Storage",
    description: "Archive events to Azure Blob Storage containers",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        connection_string: {
          type: "string",
          description: "Azure Storage connection string",
          sensitive: true,
        },
        storage_account: {
          type: "string",
          description: "Azure Storage account name (alternative to connection string)",
        },
        container_name: {
          type: "string",
          description: "Blob container name",
        },
        blob_prefix: {
          type: "string",
          description: "Blob name prefix template (default: date=%F)",
        },
        blob_append_uuid: {
          type: "boolean",
          description: "Append UUID to blob name (default: true)",
        },
        blob_time_format: {
          type: "string",
          description: "Time format for blob name (default: %s)",
        },
        ...encodingSchema(["json", "ndjson", "text", "csv", "raw_message"]),
        ...compressionSchema(["gzip", "none", "zlib", "zstd"], "gzip"),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "300" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["container_name"],
    },
  },
  {
    type: "azure_monitor_logs",
    kind: "sink",
    displayName: "Azure Monitor Logs",
    description: "Send log events to Azure Monitor via the Data Collector API",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "Azure Log Analytics workspace ID",
        },
        shared_key: {
          type: "string",
          description: "Azure shared key for authentication",
          sensitive: true,
        },
        log_type: {
          type: "string",
          description: "Custom log type name (table name in Log Analytics)",
        },
        azure_resource_id: {
          type: "string",
          description: "Azure resource ID for the logs",
        },
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["customer_id", "shared_key", "log_type"],
    },
  },
];
