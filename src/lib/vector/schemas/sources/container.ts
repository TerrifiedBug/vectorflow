import type { VectorComponentDef } from "../../types";
import { decodingSchema } from "../shared";

export const containerSources: VectorComponentDef[] = [
  {
    type: "docker_logs",
    kind: "source",
    displayName: "Docker Logs",
    description: "Collect logs from running Docker containers",
    category: "Container",
    outputTypes: ["log"],
    icon: "Container",
    configSchema: {
      type: "object",
      properties: {
        docker_host: {
          type: "string",
          description: "Docker daemon socket path (default: unix:///var/run/docker.sock)",
        },
        include_containers: {
          type: "array",
          items: { type: "string" },
          description: "Container names or IDs to include",
        },
        exclude_containers: {
          type: "array",
          items: { type: "string" },
          description: "Container names or IDs to exclude",
        },
        include_labels: {
          type: "array",
          items: { type: "string" },
          description: "Docker labels to include (e.g., com.example.team=backend)",
        },
        include_images: {
          type: "array",
          items: { type: "string" },
          description: "Image names to include",
        },
        auto_partial_merge: {
          type: "boolean",
          description: "Merge partial Docker log messages (default: true)",
        },
        multiline: {
          type: "object",
          properties: {
            start_pattern: {
              type: "string",
              description: "Regex pattern for the start of a multi-line event",
            },
            condition_pattern: {
              type: "string",
              description: "Regex pattern for continuation lines",
            },
            mode: {
              type: "string",
              enum: ["halt_before", "halt_after", "continue_through", "continue_past"],
              description: "Multi-line mode",
            },
            timeout_ms: {
              type: "number",
              description: "Max wait time for multi-line events in milliseconds (default: 1000)",
            },
          },
          description: "Multi-line log aggregation configuration",
        },
        retry_backoff_secs: {
          type: "number",
          description: "Backoff time for retrying Docker API calls (default: 2)",
        },
      },
      required: [],
    },
  },
  {
    type: "kubernetes_logs",
    kind: "source",
    displayName: "Kubernetes Logs",
    description: "Collect logs from Kubernetes pods",
    category: "Container",
    outputTypes: ["log"],
    icon: "Container",
    configSchema: {
      type: "object",
      properties: {
        self_node_name: {
          type: "string",
          description: "Node name (auto-detected via VECTOR_SELF_NODE_NAME env var)",
        },
        extra_label_selector: {
          type: "string",
          description: "Additional label selector for filtering pods",
        },
        extra_field_selector: {
          type: "string",
          description: "Additional field selector for filtering pods",
        },
        extra_namespace_label_selector: {
          type: "string",
          description: "Label selector for namespace filtering",
        },
        exclude_paths_glob_patterns: {
          type: "array",
          items: { type: "string" },
          description: "Glob patterns for log paths to exclude",
        },
        auto_partial_merge: {
          type: "boolean",
          description: "Merge partial container log messages (default: true)",
        },
        pod_annotation_fields: {
          type: "object",
          properties: {
            container_image: {
              type: "string",
              description: "Field name for container image (default: kubernetes.container_image)",
            },
            container_name: {
              type: "string",
              description: "Field name for container name (default: kubernetes.container_name)",
            },
            pod_name: {
              type: "string",
              description: "Field name for pod name (default: kubernetes.pod_name)",
            },
            pod_namespace: {
              type: "string",
              description: "Field name for pod namespace (default: kubernetes.pod_namespace)",
            },
            pod_labels: {
              type: "string",
              description: "Field name for pod labels (default: kubernetes.pod_labels)",
            },
          },
          description: "Override default Kubernetes metadata field names",
        },
        max_read_bytes: {
          type: "number",
          description: "Max bytes to read per log file per cycle (default: 2048)",
        },
        max_line_bytes: {
          type: "number",
          description: "Max line length in bytes (default: 32768)",
        },
        glob_minimum_cooldown_ms: {
          type: "number",
          description: "Minimum cooldown between glob scans in milliseconds (default: 60000)",
        },
        delay_deletion_ms: {
          type: "number",
          description: "Delay before deleting finished log files in milliseconds (default: 60000)",
        },
      },
      required: [],
    },
  },
];
