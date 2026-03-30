import { registerTemplate } from "../template-registry";

registerTemplate({
  id: "tail-elasticsearch",
  name: "File Tail -> Elasticsearch",
  description: "Read log files with tail and send to Elasticsearch. Maps FluentD in_tail + out_elasticsearch to Vector file source + elasticsearch sink.",
  fluentdPattern: "in_tail -> out_elasticsearch",
  fluentdConfig: `<source>
  @type tail
  path /var/log/nginx/access.log
  pos_file /var/log/td-agent/nginx-access.pos
  tag nginx.access
  <parse>
    @type json
  </parse>
</source>

<match nginx.**>
  @type elasticsearch
  host elasticsearch
  port 9200
  index_name nginx-logs
  type_name _doc
  <buffer tag, time>
    @type file
    path /var/log/fluentd-buffers/es
    flush_interval 5s
  </buffer>
</match>`,
  vectorBlocks: [
    {
      blockId: "tpl-tail-es-src",
      componentType: "file",
      componentId: "nginx_logs_source",
      kind: "source",
      config: {
        type: "file",
        include: ["/var/log/nginx/access.log"],
        read_from: "beginning",
      },
      inputs: [],
      confidence: 95,
      notes: ["pos_file is handled automatically by Vector's checkpointing"],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-tail-es-parse",
      componentType: "remap",
      componentId: "parse_json_logs",
      kind: "transform",
      config: {
        type: "remap",
        source: '. = parse_json!(.message)',
      },
      inputs: ["nginx_logs_source"],
      confidence: 90,
      notes: ["FluentD <parse> @type json becomes VRL parse_json!()"],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-tail-es-sink",
      componentType: "elasticsearch",
      componentId: "elasticsearch_sink",
      kind: "sink",
      config: {
        type: "elasticsearch",
        endpoints: ["http://elasticsearch:9200"],
        index: "nginx-logs",
        bulk: { index: "nginx-logs" },
        buffer: {
          type: "disk",
          max_size: 268435488,
        },
      },
      inputs: ["parse_json_logs"],
      confidence: 90,
      notes: ["FluentD buffer flush_interval maps to Vector batch timeout"],
      validationErrors: [],
      status: "translated",
    },
  ],
  docLink: "https://vector.dev/docs/reference/configuration/sinks/elasticsearch/",
  tags: ["file", "elasticsearch", "logs"],
});
