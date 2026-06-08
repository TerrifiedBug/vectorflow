import { beforeEach, describe, expect, it } from "vitest";
import { useFlowStore } from "@/stores/flow-store";
import { findComponentDef } from "@/lib/vector/catalog";
import { DLP_VRL_SOURCES } from "@/lib/vector/dlp-vrl-sources";
import type { VectorComponentDef } from "@/lib/vector/types";
import { getCompliancePresets } from "@/server/services/dlp-templates/compliance-presets";

// NF-2: applyDlpPreset adds the DLP transform node(s) bundled by a compliance
// preset to the current pipeline — one node per template id, seeded with its
// VRL source, offset so they don't overlap, dirty + undoable, no edges wired.
beforeEach(() => {
  useFlowStore.getState().clearGraph();
});

function typesOf(): string[] {
  return useFlowStore
    .getState()
    .nodes.map((n) => (n.data.componentDef as VectorComponentDef).type);
}

describe("flow-store applyDlpPreset", () => {
  it("adds one DLP transform node per template id with the right type/kind and seeded config", () => {
    const added = useFlowStore
      .getState()
      .applyDlpPreset(["dlp-credit-card-masking", "dlp-ssn-masking"]);

    expect(added).toBe(2);
    expect(typesOf()).toEqual(["dlp_credit_card_masking", "dlp_ssn_masking"]);

    for (const n of useFlowStore.getState().nodes) {
      // React Flow node type and the catalog def both report transform.
      expect(n.type).toBe("transform");
      expect((n.data.componentDef as VectorComponentDef).kind).toBe("transform");
    }

    const config = useFlowStore.getState().nodes[0].data.config as Record<string, unknown>;
    // Required VRL `source` prefilled from the template (deploy-ready, not blank).
    expect(config.source).toBe(DLP_VRL_SOURCES.dlp_credit_card_masking);
    // Schema string/array defaults seeded the same way addNode would.
    expect(config.mask_char).toBe("*");
    expect(config.fields).toEqual([".message"]);
  });

  it("offsets each node so they don't overlap one another", () => {
    useFlowStore
      .getState()
      .applyDlpPreset(["dlp-credit-card-masking", "dlp-ssn-masking", "dlp-email-redaction"]);

    const positions = useFlowStore.getState().nodes.map((n) => n.position);
    // Every position is distinct, and each cascades down-right from the last.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].x).toBeGreaterThan(positions[i - 1].x);
      expect(positions[i].y).toBeGreaterThan(positions[i - 1].y);
    }
    const unique = new Set(positions.map((p) => `${p.x},${p.y}`));
    expect(unique.size).toBe(positions.length);
  });

  it("anchors preset nodes to the right of existing content rather than over it", () => {
    // Place an existing node far to the right; the preset must land further right.
    const existing = findComponentDef("dlp_json_field_removal", "transform")!;
    useFlowStore.getState().addNode(existing, { x: 1000, y: 50 });

    useFlowStore.getState().applyDlpPreset(["dlp-credit-card-masking"]);

    const presetNode = useFlowStore.getState().nodes.at(-1)!;
    expect(presetNode.position.x).toBeGreaterThan(1000);
  });

  it("does not wire any edges (user connects the inserted transforms)", () => {
    useFlowStore
      .getState()
      .applyDlpPreset(["dlp-credit-card-masking", "dlp-ssn-masking"]);
    expect(useFlowStore.getState().edges).toHaveLength(0);
  });

  it("marks the graph dirty and pushes a single undoable snapshot", () => {
    expect(useFlowStore.getState().isDirty).toBe(false);
    expect(useFlowStore.getState().canUndo).toBe(false);

    useFlowStore.getState().applyDlpPreset(["dlp-credit-card-masking", "dlp-ssn-masking"]);

    expect(useFlowStore.getState().isDirty).toBe(true);
    expect(useFlowStore.getState().canUndo).toBe(true);
    expect(useFlowStore.getState().nodes).toHaveLength(2);

    // One snapshot for the whole batch — a single undo removes all preset nodes.
    useFlowStore.getState().undo();
    expect(useFlowStore.getState().nodes).toHaveLength(0);
    expect(useFlowStore.getState().canRedo).toBe(true);
  });

  it("skips unknown template ids and only counts the real DLP transforms", () => {
    const added = useFlowStore
      .getState()
      .applyDlpPreset(["dlp-credit-card-masking", "totally-made-up-template"]);

    expect(added).toBe(1);
    expect(typesOf()).toEqual(["dlp_credit_card_masking"]);
  });

  it("is a no-op when nothing resolves — no snapshot, stays clean", () => {
    const added = useFlowStore.getState().applyDlpPreset(["nope", "also-nope"]);

    expect(added).toBe(0);
    expect(useFlowStore.getState().nodes).toHaveLength(0);
    expect(useFlowStore.getState().isDirty).toBe(false);
    expect(useFlowStore.getState().canUndo).toBe(false);
  });

  it("applies a real compliance preset's bundled templates end-to-end", () => {
    const pci = getCompliancePresets().find((p) => p.framework === "PCI-DSS")!;
    expect(pci.templateIds.length).toBeGreaterThan(0);

    const added = useFlowStore.getState().applyDlpPreset([...pci.templateIds]);

    expect(added).toBe(pci.templateIds.length);
    const nodes = useFlowStore.getState().nodes;
    expect(nodes).toHaveLength(pci.templateIds.length);
    for (const n of nodes) {
      expect(n.type).toBe("transform");
      expect((n.data.componentDef as VectorComponentDef).type).toMatch(/^dlp_/);
    }
  });
});
