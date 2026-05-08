import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorPageSource = readFileSync("src/app/(dashboard)/pipelines/[id]/edit/page.tsx", "utf8");
const toolbarSource = readFileSync("src/components/flow/flow-toolbar.tsx", "utf8");

describe("pipeline editor chrome", () => {
  it("does not render promotion history inline beneath the editor by default", () => {
    expect(editorPageSource).not.toContain("<PromotionHistory pipelineId={pipelineId} />");
  });

  it("keeps export and settings discoverable in the toolbar", () => {
    expect(toolbarSource).toContain('label="Export"');
    expect(toolbarSource).toContain('label="Settings"');
  });

  it("opts the editor out of server rendering to avoid browser-only crashes in dev", () => {
    expect(editorPageSource).toContain("ssr: false");
  });
});
