import { registerTemplate } from "../template-registry";

registerTemplate({
  id: "forward-bridge",
  name: "Forward Protocol Bridge",
  description: "Accept FluentD forward protocol — enables incremental migration by receiving data from existing FluentD agents.",
  fluentdPattern: "in_forward -> Vector fluent source",
  fluentdConfig: `<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<match **>
  @type elasticsearch
  host es-host
  port 9200
</match>`,
  vectorBlocks: [
    {
      blockId: "tpl-fwd-src",
      componentType: "fluent",
      componentId: "fluent_source",
      kind: "source",
      config: { type: "fluent", address: "0.0.0.0:24224", mode: "tcp" },
      inputs: [],
      confidence: 90,
      notes: [
        "Vector's fluent source speaks the FluentD forward protocol — existing FluentD agents can send data here during migration",
      ],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-fwd-sink",
      componentType: "elasticsearch",
      componentId: "es_sink",
      kind: "sink",
      config: {
        type: "elasticsearch",
        endpoints: ["http://es-host:9200"],
      },
      inputs: ["fluent_source"],
      confidence: 90,
      notes: [],
      validationErrors: [],
      status: "translated",
    },
  ],
  docLink: "https://vector.dev/docs/reference/configuration/sources/fluent/",
  tags: ["forward", "bridge", "incremental-migration"],
});
