import { registerTemplate } from "../template-registry";

registerTemplate({
  id: "multi-output-fanout",
  name: "Multi-Output Fan-Out",
  description: "Send the same data to multiple sinks. Maps FluentD out_copy with multiple <store> blocks to multiple Vector sinks with shared input.",
  fluentdPattern: "out_copy -> multiple <store>",
  fluentdConfig: `<source>
  @type tail
  path /var/log/app.log
  tag app.logs
</source>

<match app.**>
  @type copy
  <store>
    @type elasticsearch
    host es-host
    port 9200
  </store>
  <store>
    @type s3
    s3_bucket backup-logs
    s3_region us-east-1
  </store>
  <store>
    @type stdout
  </store>
</match>`,
  vectorBlocks: [
    {
      blockId: "tpl-fanout-src",
      componentType: "file",
      componentId: "app_source",
      kind: "source",
      config: { type: "file", include: ["/var/log/app.log"] },
      inputs: [],
      confidence: 95,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-fanout-es",
      componentType: "elasticsearch",
      componentId: "es_sink",
      kind: "sink",
      config: { type: "elasticsearch", endpoints: ["http://es-host:9200"] },
      inputs: ["app_source"],
      confidence: 90,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-fanout-s3",
      componentType: "aws_s3",
      componentId: "s3_backup_sink",
      kind: "sink",
      config: {
        type: "aws_s3",
        bucket: "backup-logs",
        region: "us-east-1",
        encoding: { codec: "json" },
      },
      inputs: ["app_source"],
      confidence: 85,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-fanout-stdout",
      componentType: "console",
      componentId: "debug_console",
      kind: "sink",
      config: { type: "console", encoding: { codec: "json" } },
      inputs: ["app_source"],
      confidence: 95,
      notes: ["FluentD stdout maps to Vector console sink"],
      validationErrors: [],
      status: "translated",
    },
  ],
  docLink: null,
  tags: ["copy", "fan-out", "multi-sink"],
});
