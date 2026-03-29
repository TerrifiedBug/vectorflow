import { registerTemplate } from "../template-registry";

registerTemplate({
  id: "kubernetes-loki",
  name: "Kubernetes Logs -> Loki",
  description: "Collect Kubernetes container logs and send to Grafana Loki.",
  fluentdPattern: "fluent-plugin-kubernetes -> kubernetes_logs source -> loki sink",
  fluentdConfig: `<source>
  @type tail
  path /var/log/containers/*.log
  tag kubernetes.*
  <parse>
    @type cri
  </parse>
</source>

<filter kubernetes.**>
  @type kubernetes_metadata
</filter>

<match kubernetes.**>
  @type loki
  url http://loki:3100
  <label>
    app $.kubernetes.labels.app
    namespace $.kubernetes.namespace_name
  </label>
</match>`,
  vectorBlocks: [
    {
      blockId: "tpl-k8s-loki-src",
      componentType: "kubernetes_logs",
      componentId: "k8s_logs_source",
      kind: "source",
      config: { type: "kubernetes_logs" },
      inputs: [],
      confidence: 85,
      notes: [
        "Vector's kubernetes_logs source replaces both in_tail + kubernetes_metadata filter",
        "It automatically enriches logs with pod metadata",
      ],
      validationErrors: [],
      status: "translated",
    },
    {
      blockId: "tpl-k8s-loki-sink",
      componentType: "loki",
      componentId: "loki_sink",
      kind: "sink",
      config: {
        type: "loki",
        endpoint: "http://loki:3100",
        labels: {
          app: '{{ kubernetes.pod_labels."app" }}',
          namespace: "{{ kubernetes.pod_namespace }}",
        },
        encoding: { codec: "json" },
      },
      inputs: ["k8s_logs_source"],
      confidence: 80,
      notes: ["Loki label templates use Vector's template syntax, not FluentD's $ syntax"],
      validationErrors: [],
      status: "translated",
    },
  ],
  docLink: "https://vector.dev/docs/reference/configuration/sources/kubernetes_logs/",
  tags: ["kubernetes", "loki", "grafana"],
});
