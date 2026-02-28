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
          description: "The address to listen on (e.g., 0.0.0.0:514)",
        },
        mode: {
          type: "string",
          enum: ["tcp", "udp", "unix"],
          description: "Protocol to listen on",
        },
        path: {
          type: "string",
          description: "Unix socket path (when mode is unix)",
        },
        max_length: {
          type: "number",
          description: "Max syslog message length in bytes (default: 102400)",
        },
        ...tlsSchema(),
      },
      required: ["address"],
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
          description: "The address to listen on (e.g., 0.0.0.0:8080)",
        },
        encoding: {
          type: "string",
          enum: ["text", "json", "ndjson", "binary"],
          description: "Expected encoding of incoming data",
        },
        path: {
          type: "string",
          description: "URL path to accept requests on",
        },
        method: {
          type: "string",
          enum: ["POST", "PUT", "GET"],
          description: "HTTP method to accept (default: POST)",
        },
        strict_path: {
          type: "boolean",
          description: "Only accept requests on the exact path (default: true)",
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
          description: "URL to scrape",
        },
        scrape_interval_secs: {
          type: "number",
          description: "Interval between scrapes in seconds (default: 15)",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "HEAD"],
          description: "HTTP method (default: GET)",
        },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Headers to include in requests",
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
          description: "Unix socket path (for unix modes)",
        },
        max_length: {
          type: "number",
          description: "Max message length in bytes (default: 102400)",
        },
        shutdown_timeout_secs: {
          type: "number",
          description: "Timeout for graceful shutdown in seconds (default: 30)",
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
          description: "Address to listen on (default: 0.0.0.0:24224)",
        },
        ...tlsSchema(),
      },
      required: [],
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
          description: "Address to listen on (default: 0.0.0.0:5044)",
        },
        ...tlsSchema(),
      },
      required: [],
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
          description: "Address to listen on (default: 0.0.0.0:8125)",
        },
        mode: {
          type: "string",
          enum: ["tcp", "udp"],
          description: "Protocol to listen on (default: udp)",
        },
        ...tlsSchema(),
      },
      required: [],
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
          description: "Listening mode",
        },
        socket_address: {
          type: "string",
          description: "TCP address to listen on (when mode is tcp)",
        },
        socket_path: {
          type: "string",
          description: "Unix socket path (when mode is unix)",
        },
        raw_data_only: {
          type: "boolean",
          description: "Output raw dnstap data without parsing (default: false)",
        },
        multithreaded: {
          type: "boolean",
          description: "Use multithreaded runtime (default: false)",
        },
        max_frame_length: {
          type: "number",
          description: "Max frame length in bytes (default: 102400)",
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
          description: "Address to listen on (default: 0.0.0.0:6000)",
        },
        version: {
          type: "string",
          enum: ["1", "2"],
          description: "Vector protocol version (default: 2)",
        },
        shutdown_timeout_secs: {
          type: "number",
          description: "Timeout for graceful shutdown in seconds (default: 30)",
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
              description: "gRPC listen address (default: 0.0.0.0:4317)",
            },
          },
          description: "gRPC receiver configuration",
        },
        http: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "HTTP listen address (default: 0.0.0.0:4318)",
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
        url: {
          type: "string",
          description: "WebSocket URL to connect to (ws:// or wss://)",
        },
        ping_interval_secs: {
          type: "number",
          description: "Interval between ping frames in seconds",
        },
        ping_timeout_secs: {
          type: "number",
          description: "Timeout waiting for pong response in seconds",
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
      required: ["url"],
    },
  },
];
