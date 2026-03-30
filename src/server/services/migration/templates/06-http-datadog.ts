import { registerTemplate } from "../template-registry";

registerTemplate({
  id: "http-datadog",
  name: "HTTP Input -> Datadog",
  description: "Receive events via HTTP and send to Datadog Logs.",
  fluentdPattern: "in_http -> out_datadog",
  fluentdConfig: `<source>
  @type http
  port 9880
  bind 0.0.0.0
</source>

<match **>
  @type datadog
  api_key YOUR_DD_API_KEY
</match>`,
  vectorBlocks: [
    {
      blockId: "tpl-http-dd-src",
      componentType: "http_server",
      componentId: "http_source",
      kind: "source",
      config: { type: "http_server", address: "0.0.0.0:9880" },
      inputs: [],
      confidence: 85,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-http-dd-sink",
      componentType: "datadog_logs",
      componentId: "datadog_sink",
      kind: "sink",
      config: {
        type: "datadog_logs",
        default_api_key: "${DD_API_KEY}",
        site: "datadoghq.com",
      },
      inputs: ["http_source"],
      confidence: 85,
      notes: ["Replace DD_API_KEY env var with your actual Datadog API key"],
      validationErrors: [],
      status: "translated",
    },
  ],
  docLink: "https://vector.dev/docs/reference/configuration/sinks/datadog_logs/",
  tags: ["http", "datadog"],
});
