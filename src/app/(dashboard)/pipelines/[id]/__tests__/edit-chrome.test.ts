import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorPageSource = readFileSync("src/app/(dashboard)/pipelines/[id]/edit/page.tsx", "utf8");
const toolbarSource = readFileSync("src/components/flow/flow-toolbar.tsx", "utf8");

describe("pipeline editor chrome", () => {
  it("does not render promotion history inline beneath the editor by default", () => {
    expect(editorPageSource).not.toContain("<PromotionHistory pipelineId={pipelineId} />");
  });

  it("keeps tools and settings discoverable in the toolbar", () => {
    expect(toolbarSource).toContain('label="Tools"');
    expect(toolbarSource).toContain('label="Settings"');
  });

  it("keeps the pipeline identity region from crowding toolbar actions", () => {
    expect(toolbarSource).toContain('data-testid="pipeline-toolbar-identity"');
    expect(toolbarSource).toContain('className="flex min-w-0 items-center gap-1.5 overflow-hidden"');
    expect(toolbarSource).toContain('data-testid="pipeline-toolbar-actions"');
    expect(toolbarSource).toContain('className="flex shrink-0 items-center gap-2 border-l border-line pl-2"');
  });

  it("opts the editor out of server rendering to avoid browser-only crashes in dev", () => {
    expect(editorPageSource).toContain("ssr: false");
  });
});
