import { registerTemplate } from "../template-registry";

registerTemplate({
  id: "syslog-elasticsearch",
  name: "Syslog -> Elasticsearch",
  description: "Receive syslog messages and send to Elasticsearch.",
  fluentdPattern: "in_syslog -> out_elasticsearch",
  fluentdConfig: `<source>
  @type syslog
  port 5140
  tag syslog
</source>

<match syslog.**>
  @type elasticsearch
  host es-host
  port 9200
  index_name syslog-logs
</match>`,
  vectorBlocks: [
    {
      blockId: "tpl-syslog-es-src",
      componentType: "syslog",
      componentId: "syslog_source",
      kind: "source",
      config: { type: "syslog", address: "0.0.0.0:5140", mode: "tcp" },
      inputs: [],
      confidence: 90,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-syslog-es-sink",
      componentType: "elasticsearch",
      componentId: "es_sink",
      kind: "sink",
      config: {
        type: "elasticsearch",
        endpoints: ["http://es-host:9200"],
        index: "syslog-logs",
      },
      inputs: ["syslog_source"],
      confidence: 90,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
  ],
  docLink: "https://vector.dev/docs/reference/configuration/sources/syslog/",
  tags: ["syslog", "elasticsearch"],
});
