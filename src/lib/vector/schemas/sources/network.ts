import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  decodingSchema,
  framingSchema,
  authBasicBearerSchema,
} from "../shared";

export const networkSources: VectorComponentDef[] = [
  {
    type: "syslog",
    kind: "source",
    displayName: "Syslog",
    description: "Receive syslog messages over TCP or UDP",
    category: "Network",
    outputTypes: ["log"],
    icon: "Globe",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            "The socket address to listen for connections on, or systemd{#N} for systemd socket activation",
        },
        mode: {
          type: "string",
          enum: ["tcp", "udp", "unix"],
          description: "The type of socket to use",
        },
        path: {
          type: "string",
          description: "Unix socket path. Must be an absolute path (when mode is unix)",
        },
        max_length: {
          type: "number",
          description: "Max syslog message length in bytes",
          default: 102400,
        },
        host_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the peer host to each event",
        },
        connection_limit: {
          type: "number",
          description:
            "The maximum number of TCP connections that are allowed at any given time",
        },
        receive_buffer_bytes: {
          type: "number",
          description: "The size of the receive buffer used for each connection",
        },
        socket_file_mode: {
          type: "number",
          description:
            "Unix file mode bits to be applied to the unix socket file as its designated file permissions",
        },
        ...tlsSchema(),
      },
      required: ["mode"],
    },
  },
  {
    type: "http_server",
    kind: "source",
    displayName: "HTTP Server",
    description: "Receive events via HTTP requests",
    category: "Network",
    outputTypes: ["log"],
    icon: "Server",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The socket address to listen for connections on (e.g., 0.0.0.0:80)",
        },
        encoding: {
          type: "string",
          enum: ["text", "json", "ndjson", "binary"],
          description: "Expected encoding of incoming data",
        },
        path: {
          type: "string",
          description: "The HTTP path to listen on",
          default: "/",
        },
        method: {
          type: "string",
          enum: ["POST", "PUT", "GET"],
          description: "HTTP method to accept",
          default: "POST",
        },
        strict_path: {
          type: "boolean",
          description:
            "Whether or not to treat the configured path as an absolute path",
          default: true,
        },
        headers: {
          type: "array",
          items: { type: "string" },
          description: "Headers to include as event fields",
        },
        query_parameters: {
          type: "array",
          items: { type: "string" },
          description: "Query parameters to include as event fields",
        },
        host_key: {
          type: "string",
          description: "The key to use for identifying the host",
        },
        path_key: {
          type: "string",
          description: "The key to use for identifying the path",
        },
        response_code: {
          type: "number",
          description: "The HTTP status code to return on success",
          default: 200,
        },
        ...authBasicBearerSchema(),
        ...tlsSchema(),
        ...decodingSchema(),
        ...framingSchema(),
      },
      required: ["address"],
    },
  },
  {
    type: "http_client",
    kind: "source",
    displayName: "HTTP Client",
    description: "Scrape events from an HTTP endpoint on a timer",
    category: "Network",
    outputTypes: ["log"],
    icon: "Globe",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "The URL of the HTTP endpoint to fetch data from",
        },
        scrape_interval_secs: {
          type: "number",
          description: "The interval between scrapes in seconds",
          default: 15,
        },
        scrape_timeout_secs: {
          type: "number",
          description: "The timeout for each scrape request in seconds",
          default: 5,
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "HEAD"],
          description: "HTTP method to use",
          default: "GET",
        },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Custom headers to send with requests",
        },
        query: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Custom parameters for the HTTP request query string",
        },
        ...authBasicBearerSchema(),
        ...tlsSchema(),
        ...decodingSchema(),
        ...framingSchema(),
      },
      required: ["endpoint"],
    },
  },
  {
    type: "socket",
    kind: "source",
    displayName: "Socket",
    description: "Receive events over a raw TCP, UDP, or Unix socket",
    category: "Network",
    outputTypes: ["log"],
    icon: "Globe",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Socket address to listen on (e.g., 0.0.0.0:9000)",
        },
        mode: {
          type: "string",
          enum: ["tcp", "udp", "unix_datagram", "unix_stream"],
          description: "Socket mode",
        },
        path: {
          type: "string",
          description: "Unix socket path. Must be an absolute path (for unix modes)",
        },
        max_length: {
          type: "number",
          description: "Max message length in bytes",
          default: 102400,
        },
        shutdown_timeout_secs: {
          type: "number",
          description: "Timeout before a connection is forcefully closed during shutdown in seconds",
          default: 30,
        },
        host_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the peer host to each event",
        },
        port_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to add the peer port to each event",
        },
        connection_limit: {
          type: "number",
          description:
            "The maximum number of TCP connections that are allowed at any given time",
        },
        receive_buffer_bytes: {
          type: "number",
          description: "The size of the receive buffer used for each connection",
        },
        socket_file_mode: {
          type: "number",
          description:
            "Unix file mode bits to be applied to the unix socket file as its designated file permissions",
        },
        ...tlsSchema(),
        ...decodingSchema(),
        ...framingSchema(),
      },
      required: ["mode"],
    },
  },
  {
    type: "fluent",
    kind: "source",
    displayName: "Fluent",
    description: "Receive events using the Fluentd forward protocol",
    category: "Network",
    outputTypes: ["log"],
    icon: "Globe",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            "The socket address to listen for connections on, or systemd{#N} for systemd socket activation",
        },
        mode: {
          type: "string",
          enum: ["tcp", "unix"],
          description: "The type of socket to use",
        },
        path: {
          type: "string",
          description: "The Unix socket path. Must be an absolute path (when mode is unix)",
        },
        connection_limit: {
          type: "number",
          description:
            "The maximum number of TCP connections that are allowed at any given time",
        },
        receive_buffer_bytes: {
          type: "number",
          description: "The size of the receive buffer used for each connection",
        },
        socket_file_mode: {
          type: "number",
          description:
            "Unix file mode bits to be applied to the unix socket file as its designated file permissions",
        },
        ...tlsSchema(),
      },
      required: ["mode"],
    },
  },
  {
    type: "logstash",
    kind: "source",
    displayName: "Logstash",
    description: "Receive events using the Logstash input protocol",
    category: "Network",
    outputTypes: ["log"],
    icon: "Globe",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            "The socket address to listen for connections on, or systemd{#N} for systemd socket activation",
        },
        connection_limit: {
          type: "number",
          description:
            "The maximum number of TCP connections that are allowed at any given time",
        },
        receive_buffer_bytes: {
          type: "number",
          description: "The size of the receive buffer used for each connection",
        },
        ...tlsSchema(),
      },
      required: ["address"],
    },
  },
  {
    type: "statsd",
    kind: "source",
    displayName: "StatsD",
    description: "Receive StatsD-formatted metrics over UDP or TCP",
    category: "Network",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            "The socket address to listen for connections on, or systemd{#N} for systemd socket activation",
        },
        mode: {
          type: "string",
          enum: ["tcp", "udp", "unix"],
          description: "The type of socket to use",
        },
        path: {
          type: "string",
          description: "The Unix socket path. Must be an absolute path (when mode is unix)",
        },
        sanitize: {
          type: "boolean",
          description:
            "Whether or not to sanitize incoming statsd key names by replacing special characters",
          default: true,
        },
        convert_to: {
          type: "string",
          enum: ["milliseconds", "seconds"],
          description:
            "Specifies the target unit for converting incoming StatsD timing values",
          default: "seconds",
        },
        shutdown_timeout_secs: {
          type: "number",
          description:
            "The timeout before a connection is forcefully closed during shutdown in seconds",
          default: 30,
        },
        receive_buffer_bytes: {
          type: "number",
          description: "The size of the receive buffer used for each connection",
        },
        ...tlsSchema(),
      },
      required: ["mode"],
    },
  },
  {
    type: "dnstap",
    kind: "source",
    displayName: "DNStap",
    description: "Receive DNS logs via the dnstap protocol",
    category: "Network",
    status: "beta",
    outputTypes: ["log"],
    icon: "Globe",
    configSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["tcp", "unix"],
          description: "The type of dnstap socket to use",
        },
        address: {
          type: "string",
          description: "TCP address to listen on (when mode is tcp)",
        },
        socket_path: {
          type: "string",
          description:
            "Absolute path to the socket file to read DNSTAP data from (when mode is unix)",
        },
        raw_data_only: {
          type: "boolean",
          description:
            "Whether or not to skip parsing or decoding of DNSTAP frames",
        },
        multithreaded: {
          type: "boolean",
          description: "Whether or not to concurrently process DNSTAP frames",
        },
        max_frame_length: {
          type: "number",
          description: "Maximum DNSTAP frame length that the source accepts in bytes",
          default: 102400,
        },
        lowercase_hostnames: {
          type: "boolean",
          description:
            "Whether to downcase all DNSTAP hostnames received for consistency",
          default: false,
        },
        max_frame_handling_tasks: {
          type: "number",
          description:
            "Maximum number of frames that can be processed concurrently",
        },
        socket_receive_buffer_size: {
          type: "number",
          description:
            "The size, in bytes, of the receive buffer used for the socket (when mode is unix)",
        },
        shutdown_timeout_secs: {
          type: "number",
          description:
            "The timeout before a connection is forcefully closed during shutdown in seconds",
          default: 30,
        },
        socket_file_mode: {
          type: "number",
          description:
            "Unix file mode bits to be applied to the unix socket file as its designated file permissions",
        },
        ...tlsSchema(),
      },
      required: ["mode"],
    },
  },
  {
    type: "vector",
    kind: "source",
    displayName: "Vector",
    description: "Receive events from another Vector instance",
    category: "Network",
    outputTypes: ["log", "metric", "trace"],
    icon: "Zap",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The socket address to listen for connections on",
          default: "0.0.0.0:6000",
        },
        version: {
          type: "string",
          enum: ["1", "2"],
          description: "Vector protocol version",
          default: "2",
        },
        shutdown_timeout_secs: {
          type: "number",
          description:
            "The timeout before a connection is forcefully closed during shutdown in seconds",
          default: 30,
        },
        ...tlsSchema(),
      },
      required: [],
    },
  },
  {
    type: "opentelemetry",
    kind: "source",
    displayName: "OpenTelemetry",
    description: "Receive logs, metrics, and traces via OTLP gRPC or HTTP",
    category: "Network",
    outputTypes: ["log", "metric", "trace"],
    icon: "Webhook",
    configSchema: {
      type: "object",
      properties: {
        grpc: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "gRPC listen address",
              default: "0.0.0.0:4317",
            },
          },
          description: "gRPC receiver configuration",
        },
        http: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "HTTP listen address",
              default: "0.0.0.0:4318",
            },
            headers: {
              type: "array",
              items: { type: "string" },
              description:
                "A list of HTTP headers to include in the log event. Accepts wildcard (*) for matching patterns",
            },
          },
          description: "HTTP receiver configuration",
        },
        ...tlsSchema(),
      },
      required: [],
    },
  },
  {
    type: "websocket",
    kind: "source",
    displayName: "WebSocket Client",
    description: "Receive events by connecting to a WebSocket server",
    category: "Network",
    status: "beta",
    outputTypes: ["log"],
    icon: "Globe",
    configSchema: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "The WebSocket URI to connect to (ws:// or wss://)",
        },
        ping_interval: {
          type: "number",
          description: "Interval between ping frames in seconds",
        },
        ping_timeout: {
          type: "number",
          description: "Timeout waiting for pong response in seconds",
        },
        connect_timeout_secs: {
          type: "number",
          description: "Timeout for establishing the WebSocket connection in seconds",
        },
        initial_message: {
          type: "string",
          description:
            "An initial message to send to the server after connection is established",
        },
        initial_message_timeout_secs: {
          type: "number",
          description:
            "Timeout for the initial message to be sent in seconds",
        },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Custom headers to include in the WebSocket handshake",
        },
        ...authBasicBearerSchema(),
        ...tlsSchema(),
        ...decodingSchema(),
        ...framingSchema(),
      },
      required: ["uri"],
    },
  },
];
