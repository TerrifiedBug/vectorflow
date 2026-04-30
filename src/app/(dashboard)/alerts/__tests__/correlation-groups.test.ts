import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const alertsPageSource = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");
const rowSource = readFileSync(
  join(__dirname, "..", "_components", "correlation-group-row.tsx"),
  "utf8",
);
const detailSource = readFileSync(
  join(__dirname, "..", "_components", "correlation-group-detail.tsx"),
  "utf8",
);

describe("alert correlation group UI", () => {
  it("does not render the standalone anomaly history workaround in grouped view", () => {
    expect(alertsPageSource).not.toContain("AnomalyHistorySection");
    expect(alertsPageSource).not.toContain(
      "Anomalies aren't part of AlertCorrelationGroup yet",
    );
    expect(alertsPageSource).toContain("CorrelatedAlertHistory");
  });

  it("summarizes mixed alert and anomaly group contents", () => {
    expect(rowSource).toContain("anomalyEvents");
    expect(rowSource).toContain("timeline");
    expect(rowSource).toContain("signal");
    expect(rowSource).toContain("group.alertCount");
    expect(rowSource).toContain("group.anomalyCount");
    expect(rowSource).toContain("group.signalCount");
    expect(rowSource).not.toContain("const alertCount = group.events.length");
    expect(rowSource).not.toContain(
      "const anomalyCount = group.anomalyEvents.length",
    );
  });

  it("renders group detail rows from the mixed timeline", () => {
    expect(detailSource).toContain("group.timeline.map");
    expect(detailSource).toContain('event.kind === "alert"');
    expect(detailSource).toContain('event.kind === "anomaly"');
    expect(detailSource).toContain("formatAnomalyType");
  });

  it("shows group actions for open anomaly-only groups", () => {
    expect(detailSource).toContain("activeSignalCount");
    expect(detailSource).toContain('group.anomalyEvents.filter((e) => e.status === "open").length');
    expect(detailSource).not.toContain("const hasFiringEvents = group.events.some");
  });
});
