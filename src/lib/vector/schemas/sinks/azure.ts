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
        container_name: {
          type: "string",
          description: "Name of the Azure Blob Storage container",
        },
        blob_prefix: {
          type: "string",
          description: "Prefix for blob names",
          default: "blob/%F/",
        },
        blob_append_uuid: {
          type: "boolean",
          description:
            "Whether to append a UUID v4 token to the end of the blob key",
          default: false,
        },
        blob_time_format: {
          type: "string",
          description:
            "Time format for blob name using strftime specifiers",
          default: "%s",
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
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "gzip",
        ),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "300" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["connection_string", "container_name", "encoding"],
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
          description: "The unique identifier for the Log Analytics workspace",
        },
        shared_key: {
          type: "string",
          description:
            "The primary or secondary key for the Log Analytics workspace",
          sensitive: true,
        },
        log_type: {
          type: "string",
          description:
            "The record type of the data being submitted (table name in Log Analytics)",
        },
        azure_resource_id: {
          type: "string",
          description:
            "The Azure resource ID to associate data with a specific Azure resource",
        },
        host: {
          type: "string",
          description: "The Azure Monitor endpoint host",
          default: "ods.opinsights.azure.com",
        },
        time_generated_key: {
          type: "string",
          description:
            "The log field to use as the TimeGenerated value instead of the current time",
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
