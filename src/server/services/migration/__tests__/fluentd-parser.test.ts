import { describe, it, expect } from "vitest";
import { parseFluentdConfig } from "../fluentd-parser";

describe("parseFluentdConfig", () => {
  describe("basic block parsing", () => {
    it("parses a simple source block with @type", () => {
      const config = `
<source>
  @type tail
  path /var/log/nginx/access.log
  tag nginx.access
  pos_file /var/log/td-agent/nginx-access.pos
  <parse>
    @type json
  </parse>
</source>`;

      const result = parseFluentdConfig(config);

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].blockType).toBe("source");
      expect(result.blocks[0].pluginType).toBe("tail");
      expect(result.blocks[0].params.path).toBe("/var/log/nginx/access.log");
      expect(result.blocks[0].params.tag).toBe("nginx.access");
      expect(result.blocks[0].params.pos_file).toBe("/var/log/td-agent/nginx-access.pos");
      expect(result.blocks[0].tagPattern).toBeNull();

      // Nested parse block
      expect(result.blocks[0].nestedBlocks).toHaveLength(1);
      expect(result.blocks[0].nestedBlocks[0].pluginType).toBe("json");
    });

    it("parses a match block with tag pattern", () => {
      const config = `
<match kubernetes.**>
  @type elasticsearch
  host elasticsearch.logging.svc
  port 9200
  index_name k8s-logs
  type_name _doc
  <buffer tag, time>
    @type file
    path /var/log/fluentd-buffers/es-buffer
    chunk_limit_size 8M
    flush_interval 5s
    retry_max_interval 30
  </buffer>
</match>`;

      const result = parseFluentdConfig(config);

      expect(result.blocks).toHaveLength(1);
      const match = result.blocks[0];
      expect(match.blockType).toBe("match");
      expect(match.pluginType).toBe("elasticsearch");
      expect(match.tagPattern).toBe("kubernetes.**");
      expect(match.params.host).toBe("elasticsearch.logging.svc");
      expect(match.params.port).toBe("9200");

      // Buffer sub-block
      expect(match.nestedBlocks).toHaveLength(1);
      const buffer = match.nestedBlocks[0];
      expect(buffer.pluginType).toBe("file");
      expect(buffer.params.chunk_limit_size).toBe("8M");
      expect(buffer.params.flush_interval).toBe("5s");
    });

    it("parses a filter block with tag pattern", () => {
      const config = `
<filter app.**>
  @type record_transformer
  enable_ruby true
  <record>
    hostname "#{Socket.gethostname}"
    tag \${tag}
  </record>
</filter>`;

      const result = parseFluentdConfig(config);

      expect(result.blocks).toHaveLength(1);
      const filter = result.blocks[0];
      expect(filter.blockType).toBe("filter");
      expect(filter.pluginType).toBe("record_transformer");
      expect(filter.tagPattern).toBe("app.**");
    });

    it("parses a label block", () => {
      const config = `
<label @ERROR>
  <match **>
    @type file
    path /var/log/fluentd/error
  </match>
</label>`;

      const result = parseFluentdConfig(config);

      expect(result.blocks).toHaveLength(1);
      const label = result.blocks[0];
      expect(label.blockType).toBe("label");
      expect(label.labelName).toBe("@ERROR");
    });
  });

  describe("Ruby expression detection", () => {
    it("flags Ruby expressions in parameter values", () => {
      const config = `
<source>
  @type tail
  path "#{ENV['LOG_PATH']}/access.log"
  tag "#{ENV['CLUSTER_NAME']}.nginx"
</source>`;

      const result = parseFluentdConfig(config);

      expect(result.blocks[0].rubyExpressions).toHaveLength(2);
      expect(result.blocks[0].rubyExpressions).toContain("#{ENV['LOG_PATH']}");
      expect(result.blocks[0].rubyExpressions).toContain("#{ENV['CLUSTER_NAME']}");
      expect(result.complexity.rubyExpressionCount).toBe(2);
    });
  });

  describe("@include handling", () => {
    it("collects @include directives", () => {
      const config = `
@include conf.d/*.conf
@include /etc/fluentd/common.conf

<source>
  @type forward
  port 24224
</source>`;

      const result = parseFluentdConfig(config);

      expect(result.includes).toHaveLength(2);
      expect(result.includes).toContain("conf.d/*.conf");
      expect(result.includes).toContain("/etc/fluentd/common.conf");
      expect(result.blocks).toHaveLength(1);
    });
  });

  describe("global parameters", () => {
    it("collects parameters outside any block", () => {
      const config = `
@include conf.d/*.conf
root_dir /var/log/fluentd

<source>
  @type forward
</source>`;

      const result = parseFluentdConfig(config);

      expect(result.globalParams.root_dir).toBe("/var/log/fluentd");
    });
  });

  describe("comments and empty lines", () => {
    it("ignores comments and empty lines", () => {
      const config = `
# This is a comment
  # Indented comment

<source>
  @type forward
  # Inline comment above param
  port 24224
</source>

# Another comment`;

      const result = parseFluentdConfig(config);

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].pluginType).toBe("forward");
      expect(result.blocks[0].params.port).toBe("24224");
    });
  });

  describe("quoted values", () => {
    it("strips single and double quotes from values", () => {
      const config = `
<source>
  @type tail
  path "/var/log/app.log"
  tag 'app.logs'
</source>`;

      const result = parseFluentdConfig(config);

      expect(result.blocks[0].params.path).toBe("/var/log/app.log");
      expect(result.blocks[0].params.tag).toBe("app.logs");
    });
  });

  describe("complexity metrics", () => {
    it("computes complexity for a multi-block config", () => {
      const config = `
<source>
  @type tail
  path /var/log/nginx/access.log
  tag nginx.access
  <parse>
    @type json
  </parse>
</source>

<source>
  @type tail
  path /var/log/app/production.log
  tag app.production
  <parse>
    @type regexp
    expression /^(?<time>[^ ]+) (?<level>[^ ]+) (?<message>.*)$/
  </parse>
</source>

<filter nginx.**>
  @type record_transformer
  <record>
    hostname "#{Socket.gethostname}"
  </record>
</filter>

<filter app.**>
  @type grep
  <regexp>
    key level
    pattern /^(ERROR|WARN)$/
  </regexp>
</filter>

<match nginx.**>
  @type elasticsearch
  host es-host
  port 9200
  <buffer>
    @type file
    path /var/log/fluentd-buffers/es
  </buffer>
</match>

<match app.**>
  @type kafka2
  brokers kafka:9092
  topic_key tag
</match>`;

      const result = parseFluentdConfig(config);

      expect(result.complexity.totalBlocks).toBeGreaterThanOrEqual(6);
      expect(result.complexity.uniquePlugins).toContain("tail");
      expect(result.complexity.uniquePlugins).toContain("elasticsearch");
      expect(result.complexity.uniquePlugins).toContain("kafka2");
      expect(result.complexity.routingBranches).toBe(2); // nginx.**, app.** (deduplicated)
      expect(result.complexity.rubyExpressionCount).toBe(1);
    });

    it("returns empty complexity for empty config", () => {
      const result = parseFluentdConfig("");

      expect(result.blocks).toHaveLength(0);
      expect(result.complexity.totalBlocks).toBe(0);
      expect(result.complexity.uniquePlugins).toHaveLength(0);
    });
  });

  describe("real-world configs", () => {
    it("parses a Kubernetes FluentD DaemonSet config", () => {
      const config = `
<source>
  @type tail
  @id in_tail_container_logs
  path /var/log/containers/*.log
  pos_file /var/log/fluentd-containers.log.pos
  tag kubernetes.*
  read_from_head true
  <parse>
    @type cri
    merge_cri_fields true
  </parse>
</source>

<filter kubernetes.**>
  @type kubernetes_metadata
  @id filter_kube_metadata
  kubernetes_url "#{ENV['KUBERNETES_SERVICE_HOST']}:#{ENV['KUBERNETES_SERVICE_PORT']}"
  cache_size 1000
  watch true
</filter>

<filter kubernetes.**>
  @type record_transformer
  enable_ruby
  <record>
    cluster_name "#{ENV['CLUSTER_NAME'] || 'default'}"
  </record>
</filter>

<match kubernetes.**>
  @type elasticsearch
  @id out_es
  host "#{ENV['ES_HOST']}"
  port "#{ENV['ES_PORT'] || 9200}"
  scheme https
  ssl_verify false
  logstash_format true
  logstash_prefix k8s
  reconnect_on_error true
  reload_on_failure true
  reload_connections false
  request_timeout 15s
  <buffer>
    @type file
    path /var/log/fluentd-buffers/kubernetes.system.buffer
    flush_mode interval
    retry_type exponential_backoff
    flush_thread_count 2
    flush_interval 5s
    retry_forever
    retry_max_interval 30
    chunk_limit_size 2M
    queue_limit_length 8
    overflow_action block
  </buffer>
</match>`;

      const result = parseFluentdConfig(config);

      // Should have 4 top-level blocks
      expect(result.blocks).toHaveLength(4);

      // Source
      expect(result.blocks[0].blockType).toBe("source");
      expect(result.blocks[0].pluginType).toBe("tail");
      expect(result.blocks[0].params["@id"]).toBe("in_tail_container_logs");

      // Filter 1 (kubernetes_metadata)
      expect(result.blocks[1].blockType).toBe("filter");
      expect(result.blocks[1].pluginType).toBe("kubernetes_metadata");
      expect(result.blocks[1].tagPattern).toBe("kubernetes.**");

      // Filter 2 (record_transformer)
      expect(result.blocks[2].blockType).toBe("filter");
      expect(result.blocks[2].pluginType).toBe("record_transformer");

      // Match
      expect(result.blocks[3].blockType).toBe("match");
      expect(result.blocks[3].pluginType).toBe("elasticsearch");
      expect(result.blocks[3].tagPattern).toBe("kubernetes.**");

      // Ruby expressions
      expect(result.complexity.rubyExpressionCount).toBeGreaterThanOrEqual(4);

      // Buffer nesting
      const esMatch = result.blocks[3];
      expect(esMatch.nestedBlocks).toHaveLength(1);
      expect(esMatch.nestedBlocks[0].pluginType).toBe("file");
    });

    it("parses a multi-output copy config", () => {
      const config = `
<match app.**>
  @type copy
  <store>
    @type elasticsearch
    host es-host
    port 9200
  </store>
  <store>
    @type s3
    s3_bucket my-logs-bucket
    s3_region us-west-2
    path logs/
  </store>
  <store>
    @type stdout
  </store>
</match>`;

      const result = parseFluentdConfig(config);

      expect(result.blocks).toHaveLength(1);
      const copyMatch = result.blocks[0];
      expect(copyMatch.pluginType).toBe("copy");

      // Three store sub-blocks
      expect(copyMatch.nestedBlocks).toHaveLength(3);
      expect(copyMatch.nestedBlocks[0].pluginType).toBe("elasticsearch");
      expect(copyMatch.nestedBlocks[1].pluginType).toBe("s3");
      expect(copyMatch.nestedBlocks[2].pluginType).toBe("stdout");
    });

    it("parses label routing with @label", () => {
      const config = `
<source>
  @type forward
  port 24224
</source>

<source>
  @type tail
  path /var/log/app.log
  tag app.logs
  @label @PROCESSING
</source>

<label @PROCESSING>
  <filter **>
    @type grep
    <regexp>
      key level
      pattern /^(ERROR|WARN)$/
    </regexp>
  </filter>

  <match **>
    @type elasticsearch
    host es-host
  </match>
</label>`;

      const result = parseFluentdConfig(config);

      expect(result.blocks).toHaveLength(3); // 2 sources + 1 label
      expect(result.blocks[2].blockType).toBe("label");
      expect(result.blocks[2].labelName).toBe("@PROCESSING");
    });
  });

  describe("line range tracking", () => {
    it("tracks start and end lines for blocks", () => {
      const config = `<source>
  @type tail
  path /var/log/app.log
</source>`;

      const result = parseFluentdConfig(config);

      expect(result.blocks[0].lineRange[0]).toBe(1); // 1-indexed
      expect(result.blocks[0].lineRange[1]).toBeGreaterThan(1);
    });
  });

  describe("rawText preservation", () => {
    it("preserves original block text", () => {
      const config = `<source>
  @type forward
  port 24224
</source>`;

      const result = parseFluentdConfig(config);

      expect(result.blocks[0].rawText).toContain("@type forward");
      expect(result.blocks[0].rawText).toContain("port 24224");
    });
  });
});
