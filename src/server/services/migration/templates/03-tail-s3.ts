import { registerTemplate } from "../template-registry";

registerTemplate({
  id: "tail-s3",
  name: "File Tail -> S3 Archive",
  description: "Read log files and archive to S3. Maps FluentD in_tail + out_s3 to Vector file source + aws_s3 sink.",
  fluentdPattern: "in_tail -> out_s3",
  fluentdConfig: `<source>
  @type tail
  path /var/log/app/*.log
  tag app.logs
  <parse>
    @type json
  </parse>
</source>

<match app.**>
  @type s3
  s3_bucket my-log-archive
  s3_region us-west-2
  path logs/%Y/%m/%d/
  <buffer time>
    @type file
    path /var/log/fluentd-buffers/s3
    timekey 3600
    timekey_wait 10m
  </buffer>
</match>`,
  vectorBlocks: [
    {
      blockId: "tpl-tail-s3-src",
      componentType: "file",
      componentId: "app_logs_source",
      kind: "source",
      config: { type: "file", include: ["/var/log/app/*.log"] },
      inputs: [],
      confidence: 95,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-tail-s3-sink",
      componentType: "aws_s3",
      componentId: "s3_archive_sink",
      kind: "sink",
      config: {
        type: "aws_s3",
        bucket: "my-log-archive",
        region: "us-west-2",
        key_prefix: "logs/%Y/%m/%d/",
        encoding: { codec: "json" },
        batch: { timeout_secs: 3600 },
      },
      inputs: ["app_logs_source"],
      confidence: 85,
      notes: ["FluentD timekey maps to Vector batch timeout_secs"],
      validationErrors: [],
      status: "translated",
    },
  ],
  docLink: "https://vector.dev/docs/reference/configuration/sinks/aws_s3/",
  tags: ["file", "s3", "archive"],
});
