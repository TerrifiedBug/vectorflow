import type { VectorComponentDef } from "../../types";

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
          default: true,
        },
        partial_event_marker_field: {
          type: "string",
          description: "Field name for the partial event marker",
        },
        host_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the current hostname to each event",
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
              enum: ["halt_before", "halt_with", "continue_through", "continue_past"],
              description: "Multi-line mode",
            },
            timeout_ms: {
              type: "number",
              description: "Max wait time for multi-line events in milliseconds (default: 1000)",
              default: 1000,
            },
          },
          description: "Multi-line log aggregation configuration",
        },
        retry_backoff_secs: {
          type: "number",
          description: "Backoff time for retrying Docker API calls (default: 2)",
          default: 2,
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
          description: "Glob patterns for log paths to exclude (default: [\"**/*.gz\", \"**/*.tmp\"])",
        },
        auto_partial_merge: {
          type: "boolean",
          description: "Merge partial container log messages (default: true)",
          default: true,
        },
        pod_annotation_fields: {
          type: "object",
          properties: {
            container_id: {
              type: "string",
              description:
                "Field name for container ID (default: .kubernetes.container_id)",
            },
            container_image: {
              type: "string",
              description:
                "Field name for container image (default: .kubernetes.container_image)",
            },
            container_image_id: {
              type: "string",
              description:
                "Field name for container image ID (default: .kubernetes.container_image_id)",
            },
            container_name: {
              type: "string",
              description:
                "Field name for container name (default: .kubernetes.container_name)",
            },
            pod_annotations: {
              type: "string",
              description:
                "Field name for pod annotations (default: .kubernetes.pod_annotations)",
            },
            pod_ip: {
              type: "string",
              description: "Field name for pod IP (default: .kubernetes.pod_ip)",
            },
            pod_ips: {
              type: "string",
              description:
                "Field name for pod IPs (default: .kubernetes.pod_ips)",
            },
            pod_labels: {
              type: "string",
              description:
                "Field name for pod labels (default: .kubernetes.pod_labels)",
            },
            pod_name: {
              type: "string",
              description:
                "Field name for pod name (default: .kubernetes.pod_name)",
            },
            pod_namespace: {
              type: "string",
              description:
                "Field name for pod namespace (default: .kubernetes.pod_namespace)",
            },
            pod_node_name: {
              type: "string",
              description:
                "Field name for pod node name (default: .kubernetes.pod_node_name)",
            },
            pod_owner: {
              type: "string",
              description:
                "Field name for pod owner (default: .kubernetes.pod_owner)",
            },
            pod_uid: {
              type: "string",
              description:
                "Field name for pod UID (default: .kubernetes.pod_uid)",
            },
          },
          description: "Override default Kubernetes Pod metadata field names",
        },
        namespace_annotation_fields: {
          type: "object",
          properties: {
            namespace_labels: {
              type: "string",
              description:
                "Field name for namespace labels (default: .kubernetes.namespace_labels)",
            },
          },
          description: "Override default Kubernetes Namespace metadata field names",
        },
        node_annotation_fields: {
          type: "object",
          properties: {
            node_labels: {
              type: "string",
              description:
                "Field name for node labels (default: .kubernetes.node_labels)",
            },
          },
          description: "Override default Kubernetes Node metadata field names",
        },
        max_read_bytes: {
          type: "number",
          description: "Max bytes to read per log file per cycle (default: 2048)",
          default: 2048,
        },
        max_line_bytes: {
          type: "number",
          description: "Max line length in bytes (default: 32768)",
          default: 32768,
        },
        max_merged_line_bytes: {
          type: "number",
          description:
            "Max bytes a line can contain after merging before being discarded",
        },
        oldest_first: {
          type: "boolean",
          description:
            "Prioritize draining oldest files before moving to recent files (default: true)",
          default: true,
        },
        glob_minimum_cooldown_ms: {
          type: "number",
          description: "Minimum cooldown between glob scans in milliseconds (default: 60000)",
          default: 60000,
        },
        delay_deletion_ms: {
          type: "number",
          description:
            "Delay before removing metadata entries from cache after pod deletion in milliseconds (default: 60000)",
          default: 60000,
        },
      },
      required: [],
    },
  },
];
