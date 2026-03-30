import { registerTemplate } from "../template-registry";

registerTemplate({
  id: "log-parsing-enrichment",
  name: "Log Parsing + Enrichment",
  description: "Parse raw logs and add enrichment fields. Maps FluentD filter_parser + filter_record_transformer to a Vector remap transform.",
  fluentdPattern: "filter_parser + filter_record_transformer -> remap transform",
  fluentdConfig: `<source>
  @type tail
  path /var/log/app.log
  tag app.raw
  <parse>
    @type none
  </parse>
</source>

<filter app.**>
  @type parser
  key_name message
  <parse>
    @type regexp
    expression /^(?<time>[^ ]+) (?<level>\\w+) (?<class>[^ ]+) - (?<msg>.*)$/
  </parse>
</filter>

<filter app.**>
  @type record_transformer
  enable_ruby
  <record>
    hostname "#{Socket.gethostname}"
    environment production
  </record>
</filter>

<match app.**>
  @type elasticsearch
  host es-host
</match>`,
  vectorBlocks: [
    {
      blockId: "tpl-parse-src",
      componentType: "file",
      componentId: "raw_logs_source",
      kind: "source",
      config: { type: "file", include: ["/var/log/app.log"] },
      inputs: [],
      confidence: 95,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-parse-remap",
      componentType: "remap",
      componentId: "parse_and_enrich",
      kind: "transform",
      config: {
        type: "remap",
        source: [
          '# Parse structured fields from raw log line',
          'parsed = parse_regex!(.message, r\'^(?P<time>[^ ]+) (?P<level>\\w+) (?P<class>[^ ]+) - (?P<msg>.*)$\')',
          '.timestamp = parsed.time',
          '.level = parsed.level',
          '.class = parsed.class',
          '.message = parsed.msg',
          '',
          '# Enrichment fields',
          '.hostname = get_hostname!()',
          '.environment = "production"',
        ].join("\n"),
      },
      inputs: ["raw_logs_source"],
      confidence: 80,
      notes: [
        "FluentD filter_parser + filter_record_transformer combined into single VRL remap",
        "Ruby Socket.gethostname maps to VRL get_hostname!()",
      ],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-parse-sink",
      componentType: "elasticsearch",
      componentId: "es_sink",
      kind: "sink",
      config: { type: "elasticsearch", endpoints: ["http://es-host:9200"] },
      inputs: ["parse_and_enrich"],
      confidence: 90,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
  ],
  docLink: "https://vector.dev/docs/reference/vrl/",
  tags: ["parsing", "enrichment", "vrl"],
});
