import { describe, it, expect } from "vitest";
import { parseFluentdConfig } from "../fluentd-parser";
import { computeReadiness } from "../readiness";

describe("computeReadiness", () => {
  it("returns high score for simple well-known config", () => {
    const config = `
<source>
  @type tail
  path /var/log/app.log
  tag app.logs
  <parse>
    @type json
  </parse>
</source>

<match app.**>
  @type elasticsearch
  host es-host
  port 9200
</match>`;

    const parsed = parseFluentdConfig(config);
    const report = computeReadiness(parsed);

    expect(report.score).toBeGreaterThanOrEqual(70);
    expect(report.pluginInventory.length).toBeGreaterThan(0);
    expect(report.factors.length).toBe(4);
    expect(report.summary).toBeTruthy();
  });

  it("returns lower score for config with Ruby expressions", () => {
    const config = `
<source>
  @type tail
  path "#{ENV['LOG_PATH']}/access.log"
  tag "#{ENV['CLUSTER_NAME']}.nginx.#{Socket.gethostname}.access"
</source>

<filter **>
  @type record_transformer
  enable_ruby
  <record>
    hostname "#{Socket.gethostname}"
    timestamp "#{Time.now.strftime('%Y-%m-%dT%H:%M:%S%z')}"
    env "#{ENV['RAILS_ENV']}"
    custom "#{require 'json'; JSON.parse(record['data'])['id']}"
  </record>
</filter>

<match **>
  @type elasticsearch
  host "#{ENV['ES_HOST']}"
</match>`;

    const parsed = parseFluentdConfig(config);
    const report = computeReadiness(parsed);

    // Should be lower due to Ruby expressions
    expect(report.score).toBeLessThan(90);
    const rubyFactor = report.factors.find((f) => f.name === "Ruby Expression Complexity");
    expect(rubyFactor).toBeDefined();
    expect(rubyFactor!.score).toBeLessThan(100);
  });

  it("returns lower score for unknown plugins", () => {
    const config = `
<source>
  @type tail
  path /var/log/app.log
</source>

<filter **>
  @type custom_enterprise_plugin
  api_key secret123
</filter>

<match **>
  @type proprietary_sink
  endpoint https://internal.corp/logs
</match>`;

    const parsed = parseFluentdConfig(config);
    const report = computeReadiness(parsed);

    const unknownPlugins = report.pluginInventory.filter((p) => !p.hasVectorEquivalent);
    expect(unknownPlugins.length).toBeGreaterThan(0);
    expect(report.score).toBeLessThan(80);
  });

  it("returns lower score for configs with @include", () => {
    const config = `
@include /etc/fluentd/sources.conf
@include /etc/fluentd/filters.conf
@include /etc/fluentd/outputs.conf

<source>
  @type forward
</source>`;

    const parsed = parseFluentdConfig(config);
    const report = computeReadiness(parsed);

    const depFactor = report.factors.find((f) => f.name === "External Dependencies");
    expect(depFactor).toBeDefined();
    expect(depFactor!.score).toBeLessThan(100);
    expect(report.summary).toContain("@include");
  });

  it("returns 0 for empty config", () => {
    const parsed = parseFluentdConfig("");
    const report = computeReadiness(parsed);

    expect(report.score).toBeDefined();
    expect(report.pluginInventory).toHaveLength(0);
  });

  it("identifies plugins correctly in inventory", () => {
    const config = `
<source>
  @type tail
  path /a.log
</source>

<source>
  @type tail
  path /b.log
</source>

<match **>
  @type kafka2
  brokers localhost:9092
</match>`;

    const parsed = parseFluentdConfig(config);
    const report = computeReadiness(parsed);

    const tailPlugin = report.pluginInventory.find((p) => p.pluginType === "tail");
    expect(tailPlugin).toBeDefined();
    expect(tailPlugin!.count).toBe(2);
    expect(tailPlugin!.hasVectorEquivalent).toBe(true);
    expect(tailPlugin!.vectorEquivalent).toBe("file");

    const kafkaPlugin = report.pluginInventory.find((p) => p.pluginType === "kafka2");
    expect(kafkaPlugin).toBeDefined();
    expect(kafkaPlugin!.hasVectorEquivalent).toBe(true);
    expect(kafkaPlugin!.vectorEquivalent).toBe("kafka");
  });
});
