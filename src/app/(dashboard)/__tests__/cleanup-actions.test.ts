import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync("src/app/(dashboard)/page.tsx", "utf8");
const pipelinesSource = readFileSync("src/app/(dashboard)/pipelines/page.tsx", "utf8");
const alertsSource = readFileSync("src/app/(dashboard)/alerts/page.tsx", "utf8");
const scimPageSource = readFileSync("src/app/(dashboard)/settings/scim/page.tsx", "utf8");
const aiPageSource = readFileSync("src/app/(dashboard)/settings/ai/page.tsx", "utf8");
const pipelineDetailSource = readFileSync("src/app/(dashboard)/pipelines/[id]/page.tsx", "utf8");

describe("dashboard cleanup batch", () => {
  it("removes dead dashboard actions that do not perform real work", () => {
    expect(dashboardSource).not.toContain(">\n              Filters\n");
    expect(dashboardSource).not.toContain('href="/deploy"');
  });

  it("removes redundant alert and pipeline header actions that duplicate existing UI", () => {
    expect(alertsSource).not.toContain("Notification channels");
    expect(pipelinesSource).not.toContain(">Filter<");
  });

  it("makes SCIM and AI settings pages render truthful configuration surfaces", () => {
    expect(scimPageSource).toContain("<ScimSettings />");
    expect(scimPageSource).not.toContain("public demo");
    expect(scimPageSource).not.toContain("gated in this surface");

    expect(aiPageSource).toContain("<AiSettings />");
    expect(aiPageSource).not.toContain("feature-flagged off");
    expect(aiPageSource).not.toContain("out of scope");
  });

  it("adds a clear promotion entry on the pipeline detail surface", () => {
    expect(pipelineDetailSource).toContain('href="/promotions"');
    expect(pipelineDetailSource).toContain("Promotions");
  });
});
