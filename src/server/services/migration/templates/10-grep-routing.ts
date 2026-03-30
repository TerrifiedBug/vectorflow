import { registerTemplate } from "../template-registry";

registerTemplate({
  id: "grep-routing",
  name: "Grep Filtering + Routing",
  description: "Filter logs by pattern and route to different outputs. Maps FluentD filter_grep + rewrite_tag_filter to Vector filter + route transforms.",
  fluentdPattern: "filter_grep + rewrite_tag_filter -> filter + route transforms",
  fluentdConfig: `<source>
  @type tail
  path /var/log/app.log
  tag app.all
</source>

<filter app.**>
  @type grep
  <regexp>
    key level
    pattern /^(ERROR|WARN|INFO)$/
  </regexp>
  <exclude>
    key message
    pattern /^healthcheck/
  </exclude>
</filter>

<match app.**>
  @type rewrite_tag_filter
  <rule>
    key level
    pattern /^ERROR$/
    tag app.error
  </rule>
  <rule>
    key level
    pattern /^(WARN|INFO)$/
    tag app.normal
  </rule>
</match>

<match app.error>
  @type elasticsearch
  host es-alerts
</match>

<match app.normal>
  @type file
  path /var/log/processed/normal
</match>`,
  vectorBlocks: [
    {
      blockId: "tpl-grep-src",
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
      blockId: "tpl-grep-filter",
      componentType: "filter",
      componentId: "grep_filter",
      kind: "transform",
      config: {
        type: "filter",
        condition: '.level == "ERROR" || .level == "WARN" || .level == "INFO"',
      },
      inputs: ["app_source"],
      confidence: 85,
      notes: ["FluentD grep include/exclude combined into VRL condition"],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-grep-exclude",
      componentType: "filter",
      componentId: "exclude_healthcheck",
      kind: "transform",
      config: {
        type: "filter",
        condition: '!starts_with(to_string(.message) ?? "", "healthcheck")',
      },
      inputs: ["grep_filter"],
      confidence: 80,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-grep-route",
      componentType: "route",
      componentId: "level_router",
      kind: "transform",
      config: {
        type: "route",
        route: {
          error: '.level == "ERROR"',
          normal: '.level == "WARN" || .level == "INFO"',
        },
      },
      inputs: ["exclude_healthcheck"],
      confidence: 80,
      notes: ["FluentD rewrite_tag_filter maps to Vector route transform"],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-grep-error-sink",
      componentType: "elasticsearch",
      componentId: "error_alerts_sink",
      kind: "sink",
      config: { type: "elasticsearch", endpoints: ["http://es-alerts:9200"] },
      inputs: ["level_router.error"],
      confidence: 85,
      notes: ["Route output uses dot notation: level_router.error"],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-grep-normal-sink",
      componentType: "file",
      componentId: "normal_file_sink",
      kind: "sink",
      config: {
        type: "file",
        path: "/var/log/processed/normal/%Y-%m-%d.log",
        encoding: { codec: "json" },
      },
      inputs: ["level_router.normal"],
      confidence: 85,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
  ],
  docLink: "https://vector.dev/docs/reference/configuration/transforms/route/",
  tags: ["grep", "routing", "filter"],
});
