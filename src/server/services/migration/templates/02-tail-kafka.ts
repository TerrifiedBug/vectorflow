import { registerTemplate } from "../template-registry";

registerTemplate({
  id: "tail-kafka",
  name: "File Tail -> Kafka",
  description: "Read log files and send to Kafka. Maps FluentD in_tail + out_kafka to Vector file source + kafka sink.",
  fluentdPattern: "in_tail -> out_kafka",
  fluentdConfig: `<source>
  @type tail
  path /var/log/app/production.log
  tag app.production
  <parse>
    @type json
  </parse>
</source>

<match app.**>
  @type kafka2
  brokers kafka-broker:9092
  topic_key tag
  default_topic app-logs
  <format>
    @type json
  </format>
  <buffer tag>
    @type file
    path /var/log/fluentd-buffers/kafka
    flush_interval 3s
  </buffer>
</match>`,
  vectorBlocks: [
    {
      blockId: "tpl-tail-kafka-src",
      componentType: "file",
      componentId: "app_logs_source",
      kind: "source",
      config: { type: "file", include: ["/var/log/app/production.log"] },
      inputs: [],
      confidence: 95,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-tail-kafka-parse",
      componentType: "remap",
      componentId: "parse_app_logs",
      kind: "transform",
      config: { type: "remap", source: '. = parse_json!(.message)' },
      inputs: ["app_logs_source"],
      confidence: 90,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-tail-kafka-sink",
      componentType: "kafka",
      componentId: "kafka_sink",
      kind: "sink",
      config: {
        type: "kafka",
        bootstrap_servers: "kafka-broker:9092",
        topic: "app-logs",
        encoding: { codec: "json" },
      },
      inputs: ["parse_app_logs"],
      confidence: 90,
      notes: ["FluentD topic_key routing requires Vector route transform for multiple topics"],
      validationErrors: [],
      status: "translated",
    },
  ],
  docLink: "https://vector.dev/docs/reference/configuration/sinks/kafka/",
  tags: ["file", "kafka", "logs"],
});
