import type { VectorComponentDef } from "../types";

export const ALL_TRANSFORMS: VectorComponentDef[] = [
  {
    type: "remap",
    kind: "transform",
    displayName: "Remap (VRL)",
    description: "Transform events using Vector Remap Language",
    category: "General",
    inputTypes: ["log", "metric", "trace"],
    outputTypes: ["log", "metric", "trace"],
    icon: "Code",
    configSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "VRL program to execute on each event",
        },
        drop_on_error: {
          type: "boolean",
          default: false,
          description: "Drop events that cause a runtime error",
        },
        drop_on_abort: {
          type: "boolean",
          default: true,
          description: "Drop events that trigger an abort",
        },
        reroute_dropped: {
          type: "boolean",
          default: false,
          description:
            "Reroute dropped events to a named output instead of halting processing",
        },
        timezone: {
          type: "string",
          description: "Default timezone for timestamp operations",
        },
        file: {
          type: "string",
          description: "Path to a VRL file (alternative to inline source)",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Paths to multiple VRL files (alternative to inline source)",
        },
        metric_tag_values: {
          type: "string",
          enum: ["single", "full"],
          default: "single",
          description: "Tag value representation for metrics",
        },
      },
      required: ["source"],
    },
  },
  {
    type: "filter",
    kind: "transform",
    displayName: "Filter",
    description: "Conditionally drop events based on a VRL condition",
    category: "General",
    inputTypes: ["log", "metric", "trace"],
    outputTypes: ["log", "metric", "trace"],
    icon: "Filter",
    configSchema: {
      type: "object",
      properties: {
        condition: {
          type: "string",
          description:
            "VRL condition expression; events that evaluate to false are dropped",
        },
      },
      required: ["condition"],
    },
  },
  {
    type: "route",
    kind: "transform",
    displayName: "Route",
    description: "Conditionally route events to different outputs",
    category: "General",
    inputTypes: ["log", "metric", "trace"],
    outputTypes: ["log", "metric", "trace"],
    icon: "GitBranch",
    configSchema: {
      type: "object",
      properties: {
        route: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Map of output name to VRL condition",
        },
        reroute_unmatched: {
          type: "boolean",
          default: true,
          description:
            "Reroute unmatched events to a named output instead of silently discarding them",
        },
      },
      required: ["route"],
    },
  },
  {
    type: "sample",
    kind: "transform",
    displayName: "Sample",
    description: "Randomly sample a percentage of events",
    category: "General",
    inputTypes: ["log", "trace"],
    outputTypes: ["log", "trace"],
    icon: "Percent",
    configSchema: {
      type: "object",
      properties: {
        rate: {
          type: "number",
          description:
            "The rate at which events are forwarded, expressed as 1/N (e.g., 10 keeps 1 in 10)",
        },
        ratio: {
          type: "number",
          description:
            "The rate at which events are forwarded, expressed as a percentage (e.g., 0.13 keeps 13%)",
        },
        key_field: {
          type: "string",
          description:
            "Field whose value is hashed to determine if the event should be sampled",
        },
        group_by: {
          type: "string",
          description: "Template string to group events for sampling",
        },
        exclude: {
          type: "string",
          description: "VRL condition — matching events are always passed through",
        },
        sample_rate_key: {
          type: "string",
          default: "sample_rate",
          description:
            "Event key to store the sample rate; if empty, sample rate is not added",
        },
      },
      required: [],
    },
  },
  {
    type: "dedupe",
    kind: "transform",
    displayName: "Dedupe",
    description: "Deduplicate events based on a set of fields",
    category: "General",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Copy",
    configSchema: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          properties: {
            match: {
              type: "array",
              items: { type: "string" },
              description: "Fields to match for deduplication",
            },
            ignore: {
              type: "array",
              items: { type: "string" },
              description: "Fields to ignore for deduplication",
            },
          },
          description: "Field matching configuration",
        },
        cache: {
          type: "object",
          properties: {
            num_events: {
              type: "number",
              default: 5000,
              description:
                "Number of events to cache for dedup lookback",
            },
          },
          description: "Cache configuration",
        },
      },
      required: [],
    },
  },
  {
    type: "log_to_metric",
    kind: "transform",
    displayName: "Log to Metric",
    description: "Convert log events into metric events",
    category: "General",
    inputTypes: ["log"],
    outputTypes: ["metric"],
    icon: "BarChart",
    configSchema: {
      type: "object",
      properties: {
        all_metrics: {
          type: "boolean",
          description:
            "When true, all incoming events are processed and converted to metrics; the metrics field is ignored",
        },
        metrics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["counter", "gauge", "histogram", "set", "summary"],
              },
              field: { type: "string" },
              name: { type: "string" },
              namespace: { type: "string" },
              kind: {
                type: "string",
                enum: ["absolute", "incremental"],
                default: "incremental",
                description: "Metric kind",
              },
              increment_by_value: {
                type: "boolean",
                default: false,
                description:
                  "Increment counter by the value in field instead of by 1",
              },
              tags: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
          },
          description: "List of metric definitions to derive from logs",
        },
      },
      required: ["metrics"],
    },
  },
  {
    type: "aggregate",
    kind: "transform",
    displayName: "Aggregate",
    description: "Aggregate metric events over a time window",
    category: "Metrics",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Layers",
    configSchema: {
      type: "object",
      properties: {
        interval_ms: {
          type: "number",
          default: 10000,
          description: "Aggregation window in milliseconds",
        },
        mode: {
          type: "string",
          enum: [
            "Auto",
            "Count",
            "Diff",
            "Latest",
            "Max",
            "Mean",
            "Min",
            "Stdev",
            "Sum",
          ],
          default: "Auto",
          description: "Aggregation mode",
        },
      },
      required: [],
    },
  },
  {
    type: "aws_ec2_metadata",
    kind: "transform",
    displayName: "AWS EC2 Metadata",
    description: "Enrich events with EC2 instance metadata",
    category: "Cloud",
    inputTypes: ["log", "metric"],
    outputTypes: ["log", "metric"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          default: "http://169.254.169.254",
          description: "Instance metadata endpoint",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Metadata fields to include (e.g., instance-id, ami-id, region, availability-zone, public-hostname, local-hostname, public-ipv4, local-ipv4, instance-type, vpc-id, subnet-id, role-name)",
        },
        namespace: {
          type: "string",
          description: "Namespace for metadata fields",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to associate with the metadata",
        },
        refresh_interval_secs: {
          type: "number",
          default: 10,
          description: "How often to refresh metadata in seconds",
        },
        refresh_timeout_secs: {
          type: "number",
          default: 1,
          description: "Timeout for metadata refresh in seconds",
        },
        required: {
          type: "boolean",
          default: true,
          description:
            "Require successful metadata query before processing data",
        },
      },
      required: [],
    },
  },
  {
    type: "exclusive_route",
    kind: "transform",
    displayName: "Exclusive Route",
    description: "Route events to the first matching output only",
    category: "General",
    inputTypes: ["log", "metric", "trace"],
    outputTypes: ["log", "metric", "trace"],
    icon: "Shuffle",
    configSchema: {
      type: "object",
      properties: {
        routes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Route name (also used as transform port name)" },
              condition: {
                type: "string",
                description: "VRL condition for this route",
              },
            },
          },
          description:
            "Ordered list of routes — event goes to first match only",
        },
      },
      required: ["routes"],
    },
  },
  {
    type: "lua",
    kind: "transform",
    displayName: "Lua",
    description: "Transform events using a Lua script",
    category: "General",
    inputTypes: ["log", "metric"],
    outputTypes: ["log", "metric"],
    icon: "Code",
    configSchema: {
      type: "object",
      properties: {
        version: {
          type: "string",
          enum: ["2"],
          description: "Lua API version (only v2 supported)",
        },
        hooks: {
          type: "object",
          properties: {
            process: {
              type: "string",
              description: "Lua function name or inline code for per-event processing",
            },
            init: {
              type: "string",
              description: "Lua code to run at startup",
            },
            shutdown: {
              type: "string",
              description: "Lua code to run at shutdown",
            },
          },
          description: "Lua hook functions",
        },
        source: {
          type: "string",
          description: "Inline Lua source code",
        },
        metric_tag_values: {
          type: "string",
          enum: ["single", "full"],
          default: "single",
          description: "Tag value representation for metrics",
        },
        search_dirs: {
          type: "array",
          items: { type: "string" },
          description: "Directories to search for Lua modules",
        },
        timers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              interval_seconds: {
                type: "number",
                description: "Timer interval in seconds",
              },
              handler: {
                type: "string",
                description: "Lua function name to call",
              },
            },
          },
          description: "Periodic timer hooks",
        },
      },
      required: ["version"],
    },
  },
  {
    type: "metric_to_log",
    kind: "transform",
    displayName: "Metric to Log",
    description: "Convert metric events into log events",
    category: "General",
    inputTypes: ["metric"],
    outputTypes: ["log"],
    icon: "BarChart",
    configSchema: {
      type: "object",
      properties: {
        host_tag: {
          type: "string",
          default: "host",
          description: "Tag name to use for the host field",
        },
        timezone: {
          type: "string",
          description: "Timezone for timestamp formatting",
        },
        metric_tag_values: {
          type: "string",
          enum: ["single", "full"],
          default: "single",
          description: "Tag value representation",
        },
      },
      required: [],
    },
  },
  {
    type: "reduce",
    kind: "transform",
    displayName: "Reduce",
    description: "Combine multiple events into a single event based on conditions",
    category: "General",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Layers",
    configSchema: {
      type: "object",
      properties: {
        group_by: {
          type: "array",
          items: { type: "string" },
          description: "Fields to group events by",
        },
        merge_strategies: {
          type: "object",
          additionalProperties: {
            type: "string",
            enum: [
              "array",
              "concat",
              "concat_newline",
              "concat_raw",
              "discard",
              "flat_unique",
              "longest_array",
              "max",
              "min",
              "retain",
              "shortest_array",
              "sum",
            ],
          },
          description: "Per-field merge strategies",
        },
        starts_when: {
          type: "string",
          description: "VRL condition to start a new reduce group",
        },
        ends_when: {
          type: "string",
          description: "VRL condition to end a reduce group",
        },
        expire_after_ms: {
          type: "number",
          default: 30000,
          description: "Expire incomplete groups after milliseconds",
        },
        flush_period_ms: {
          type: "number",
          default: 1000,
          description:
            "Interval to check for and flush any expired events, in milliseconds",
        },
        end_every_period_ms: {
          type: "number",
          description:
            "If supplied, every time this interval elapses for a given grouping, the reduced value is flushed",
        },
        max_events: {
          type: "number",
          description: "Max events per group before forced flush",
        },
      },
      required: [],
    },
  },
  {
    type: "tag_cardinality_limit",
    kind: "transform",
    displayName: "Tag Cardinality Limit",
    description: "Limit the cardinality of metric tag values",
    category: "Metrics",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Shield",
    configSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["exact", "probabilistic"],
          description: "Cardinality tracking mode",
        },
        value_limit: {
          type: "number",
          default: 500,
          description: "Max unique tag values per tag key",
        },
        limit_exceeded_action: {
          type: "string",
          enum: ["drop_tag", "drop_event"],
          default: "drop_tag",
          description: "Action when limit is exceeded",
        },
        cache_size_per_key: {
          type: "number",
          default: 5120,
          description:
            "Cache size in bytes for detecting duplicate tags (relevant when mode is probabilistic)",
        },
      },
      required: ["mode"],
    },
  },
  {
    type: "throttle",
    kind: "transform",
    displayName: "Throttle",
    description: "Rate-limit events passing through",
    category: "General",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Timer",
    configSchema: {
      type: "object",
      properties: {
        threshold: {
          type: "number",
          description: "Max number of events allowed per window",
        },
        window_secs: {
          type: "number",
          default: 1,
          description: "Time window in seconds",
        },
        key_field: {
          type: "string",
          description: "Field to use for per-key throttling",
        },
        exclude: {
          type: "string",
          description: "VRL condition — matching events bypass throttle",
        },
      },
      required: ["threshold"],
    },
  },
];
