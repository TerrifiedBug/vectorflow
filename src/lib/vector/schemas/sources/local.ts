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
          description: "Where to start reading new files (default: beginning)",
        },
        max_line_bytes: {
          type: "number",
          description: "Max bytes per line before truncation (default: 102400)",
        },
        oldest_first: {
          type: "boolean",
          description: "Process older files before newer ones (default: false)",
        },
        fingerprint: {
          type: "object",
          properties: {
            strategy: {
              type: "string",
              enum: ["checksum", "device_and_inode"],
              description: "File identification strategy (default: checksum)",
            },
            bytes: {
              type: "number",
              description: "Bytes to read for checksum fingerprint (default: 256)",
            },
          },
          description: "File fingerprinting configuration",
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
              description: "Interval between executions in seconds (default: 60)",
            },
          },
          description: "Scheduled mode configuration",
        },
        streaming: {
          type: "object",
          properties: {
            respawn_on_exit: {
              type: "boolean",
              description: "Restart command when it exits (default: true)",
            },
            respawn_interval_secs: {
              type: "number",
              description: "Delay before respawning in seconds (default: 5)",
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
          description: "Include stderr output (default: true)",
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
          description: "Max line length in bytes (default: 102400)",
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
          description: "Only include logs from the current boot (default: true)",
        },
        include_units: {
          type: "array",
          items: { type: "string" },
          description: "Systemd units to include",
        },
        exclude_units: {
          type: "array",
          items: { type: "string" },
          description: "Systemd units to exclude",
        },
        include_matches: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Journal field matches to include",
        },
        journal_directory: {
          type: "string",
          description: "Custom journal directory path",
        },
        since_now: {
          type: "boolean",
          description: "Start reading from now instead of persisted cursor (default: false)",
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
          description: "Field name for the host (default: host)",
        },
        max_length: {
          type: "number",
          description: "Max line length in bytes (default: 102400)",
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
          enum: ["syslog", "common", "json", "apache_common", "apache_error", "bsd_syslog", "shuffle"],
          description: "Format of the generated logs",
        },
        interval: {
          type: "number",
          description: "Interval between events in seconds",
        },
        count: {
          type: "number",
          description: "Total number of events to generate (0 = unlimited)",
        },
        lines: {
          type: "array",
          items: { type: "string" },
          description: "Custom log lines for shuffle format",
        },
        sequence: {
          type: "boolean",
          description: "Add a sequence number field (default: false)",
        },
        ...decodingSchema(),
      },
      required: [],
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
          description: "Field name for the host (default: host)",
        },
        pid_key: {
          type: "string",
          description: "Field name for the PID (default: pid)",
        },
      },
      required: [],
    },
  },
];
