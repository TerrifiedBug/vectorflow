import type { VectorComponentDef } from "../../types";
import { decodingSchema, framingSchema } from "../shared";

export const localSources: VectorComponentDef[] = [
  {
    type: "file",
    kind: "source",
    displayName: "File",
    description: "Collect logs from files on disk",
    category: "Local",
    outputTypes: ["log"],
    icon: "FileText",
    configSchema: {
      type: "object",
      properties: {
        include: {
          type: "array",
          items: { type: "string" },
          description: "Array of file paths or globs to include",
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description: "Array of file paths or globs to exclude",
        },
        ignore_older_secs: {
          type: "number",
          description: "Ignore files older than this many seconds",
        },
        read_from: {
          type: "string",
          enum: ["beginning", "end"],
          description: "Where to start reading new files",
          default: "beginning",
        },
        max_line_bytes: {
          type: "number",
          description: "Max bytes per line before truncation",
          default: 102400,
        },
        oldest_first: {
          type: "boolean",
          description: "Process older files before newer ones",
          default: false,
        },
        fingerprint: {
          type: "object",
          properties: {
            strategy: {
              type: "string",
              enum: ["checksum", "device_and_inode"],
              description: "File identification strategy",
              default: "checksum",
            },
            lines: {
              type: "number",
              description:
                "Number of lines to read for generating the checksum fingerprint",
              default: 1,
            },
            ignored_header_bytes: {
              type: "number",
              description:
                "Number of bytes to skip at the beginning of the file when generating the checksum",
            },
          },
          description: "File fingerprinting configuration",
        },
        line_delimiter: {
          type: "string",
          description: "String sequence used to separate one file line from another",
        },
        glob_minimum_cooldown_ms: {
          type: "number",
          description:
            "Delay between file discovery calls in milliseconds",
          default: 1000,
        },
        host_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the current hostname to each event",
        },
        file_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the file path to each event",
          default: "file",
        },
        max_read_bytes: {
          type: "number",
          description:
            "Max amount of bytes to read from a single file before switching to the next file",
          default: 2048,
        },
        ignore_not_found: {
          type: "boolean",
          description:
            "Ignore missing files when fingerprinting, useful with dangling symlinks",
          default: false,
        },
        ignore_checkpoints: {
          type: "boolean",
          description:
            "Whether to ignore existing checkpoints when determining where to start reading a file",
        },
        data_dir: {
          type: "string",
          description:
            "The directory used to persist file checkpoint positions",
        },
        offset_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the offset to each event",
        },
        remove_after_secs: {
          type: "number",
          description: "Remove processed files after this many seconds",
        },
        rotate_wait_secs: {
          type: "number",
          description:
            "How long to wait for a file to reappear after being rotated",
        },
        multiline: {
          type: "object",
          properties: {
            condition_pattern: {
              type: "string",
              description:
                "Regular expression pattern used to determine if more lines should be read",
            },
            mode: {
              type: "string",
              enum: ["continue_through", "continue_past", "halt_before", "halt_with"],
              description: "Aggregation mode for multiline events",
            },
            start_pattern: {
              type: "string",
              description:
                "Regular expression pattern used to identify the start of a multiline event",
            },
            timeout_ms: {
              type: "number",
              description: "Timeout for multiline aggregation in milliseconds",
            },
          },
          description: "Multiline aggregation configuration",
        },
        internal_metrics: {
          type: "object",
          properties: {
            include_file_tag: {
              type: "boolean",
              description:
                "Whether to include the file tag on internal metrics",
              default: false,
            },
          },
          description: "Configuration of internal metrics for this source",
        },
        ...decodingSchema().decoding && { decoding: decodingSchema().decoding },
      },
      required: ["include"],
    },
  },
  {
    type: "exec",
    kind: "source",
    displayName: "Exec",
    description: "Run a command and collect its output as events",
    category: "Local",
    outputTypes: ["log"],
    icon: "Terminal",
    configSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["scheduled", "streaming"],
          description: "Execution mode",
        },
        command: {
          type: "array",
          items: { type: "string" },
          description: "Command and arguments to execute",
        },
        scheduled: {
          type: "object",
          properties: {
            exec_interval_secs: {
              type: "number",
              description: "Interval between executions in seconds",
              default: 60,
            },
          },
          description: "Scheduled mode configuration",
        },
        streaming: {
          type: "object",
          properties: {
            respawn_on_exit: {
              type: "boolean",
              description: "Restart command when it exits",
              default: true,
            },
            respawn_interval_secs: {
              type: "number",
              description: "Delay before respawning in seconds",
              default: 5,
            },
          },
          description: "Streaming mode configuration",
        },
        working_directory: {
          type: "string",
          description: "Working directory for the command",
        },
        include_stderr: {
          type: "boolean",
          description: "Include stderr output",
          default: true,
        },
        environment: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Environment variables to set for the command (key-value pairs)",
        },
        maximum_buffer_size_bytes: {
          type: "number",
          description: "Maximum buffer size allowed before a log event is generated",
          default: 1000000,
        },
        ...decodingSchema(),
        ...framingSchema(),
      },
      required: ["command", "mode"],
    },
  },
  {
    type: "stdin",
    kind: "source",
    displayName: "Stdin",
    description: "Read events from standard input",
    category: "Local",
    outputTypes: ["log"],
    icon: "ArrowDownToLine",
    configSchema: {
      type: "object",
      properties: {
        max_length: {
          type: "number",
          description: "Max line length in bytes",
          default: 102400,
        },
        host_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the current hostname to each event",
        },
        ...decodingSchema(),
        ...framingSchema(),
      },
      required: [],
    },
  },
  {
    type: "journald",
    kind: "source",
    displayName: "Journald",
    description: "Collect logs from the systemd journal",
    category: "Local",
    outputTypes: ["log"],
    icon: "FileText",
    configSchema: {
      type: "object",
      properties: {
        current_boot_only: {
          type: "boolean",
          description: "Only include entries that occurred after the current boot of the system",
          default: true,
        },
        include_units: {
          type: "array",
          items: { type: "string" },
          description:
            "Systemd units to include; unit names lacking a dot get .service appended",
        },
        exclude_units: {
          type: "array",
          items: { type: "string" },
          description:
            "Systemd units to exclude; unit names lacking a dot get .service appended",
        },
        include_matches: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } },
          description:
            "Sets of field/value pairs to monitor; if empty, all journal fields are accepted",
        },
        exclude_matches: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } },
          description:
            "Sets of field/value pairs that exclude matching journal entries",
        },
        journal_directory: {
          type: "string",
          description:
            "Full path of the journal directory; if not set, journalctl uses the default system path",
        },
        since_now: {
          type: "boolean",
          description:
            "Start reading from now instead of persisted cursor",
          default: false,
        },
        batch_size: {
          type: "number",
          description:
            "Number of events per batch; a checkpoint is set at the end of each batch",
          default: 16,
        },
        data_dir: {
          type: "string",
          description:
            "Directory used to persist file checkpoint positions",
        },
        emit_cursor: {
          type: "boolean",
          description: "Whether to emit the __CURSOR field in events",
          default: false,
        },
        extra_args: {
          type: "array",
          items: { type: "string" },
          description:
            "Extra command line arguments to pass to journalctl",
        },
        journal_namespace: {
          type: "string",
          description:
            "The journal namespace, passed to journalctl via --namespace",
        },
        journalctl_path: {
          type: "string",
          description: "Path to the journalctl executable",
        },
      },
      required: [],
    },
  },
  {
    type: "file_descriptor",
    kind: "source",
    displayName: "File Descriptor",
    description: "Read events from a file descriptor",
    category: "Local",
    status: "beta",
    outputTypes: ["log"],
    icon: "FileText",
    configSchema: {
      type: "object",
      properties: {
        fd: {
          type: "number",
          description: "File descriptor number to read from",
        },
        host_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the current hostname to each event",
        },
        max_length: {
          type: "number",
          description: "Max buffer size in bytes of incoming messages",
          default: 102400,
        },
        ...decodingSchema(),
        ...framingSchema(),
      },
      required: ["fd"],
    },
  },
  {
    type: "demo_logs",
    kind: "source",
    displayName: "Demo Logs",
    description: "Generate fake log events for testing and demos",
    category: "Testing",
    outputTypes: ["log"],
    icon: "Play",
    configSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: [
            "apache_common",
            "apache_error",
            "bsd_syslog",
            "json",
            "shuffle",
            "syslog",
          ],
          description: "Format of the randomly generated output",
        },
        interval: {
          type: "number",
          description:
            "Time in seconds to pause between each batch of output lines",
          default: 1.0,
        },
        count: {
          type: "number",
          description:
            "Total number of lines to output; by default the source continuously prints logs",
        },
        lines: {
          type: "array",
          items: { type: "string" },
          description: "Custom log lines to use when format is shuffle",
        },
        sequence: {
          type: "boolean",
          description:
            "If true, each output line starts with an increasing sequence number",
          default: false,
        },
        ...decodingSchema(),
        ...framingSchema(),
      },
      required: ["format"],
    },
  },
  {
    type: "internal_logs",
    kind: "source",
    displayName: "Internal Logs",
    description: "Collect Vector's own internal log events",
    category: "System",
    outputTypes: ["log"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        host_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the current hostname to each event",
        },
        pid_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the current process ID to each event",
        },
      },
      required: [],
    },
  },
];
