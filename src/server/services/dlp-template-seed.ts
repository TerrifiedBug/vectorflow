// src/server/services/dlp-template-seed.ts
import { prisma } from "@/lib/prisma";
import { ALL_DLP_TEMPLATES } from "./dlp-templates";
import type { DlpTemplateDefinition } from "./dlp-templates";
import { generateId } from "@/lib/utils";

/**
 * Build a single-node template graph from a DLP template definition.
 * Each DLP template becomes a single remap transform node with the VRL source pre-filled.
 */
function buildTemplateGraph(template: DlpTemplateDefinition): {
  nodes: unknown[];
  edges: unknown[];
} {
  const nodeId = generateId();

  const node = {
    id: nodeId,
    componentType: "remap",
    componentKey: template.id.replace(/^dlp-/, "").replaceAll("-", "_"),
    displayName: template.name,
    kind: "transform",
    config: {
      source: template.vrlSource,
      drop_on_error: false,
      drop_on_abort: true,
    },
    positionX: 400,
    positionY: 300,
    metadata: {
      complianceTags: template.complianceTags,
      dlpTemplateId: template.id,
      params: template.params,
      testFixtures: template.testFixtures,
    },
  };

  return {
    nodes: [node],
    edges: [],
  };
}

/**
 * Seed (upsert) all DLP templates into the Template table.
 * System-level templates have teamId = null and are visible to all teams.
 * Safe to call on every server startup — uses upsert to avoid duplicates.
 */
export async function seedDlpTemplates(): Promise<void> {
  for (const template of ALL_DLP_TEMPLATES) {
    const graph = buildTemplateGraph(template);

    await prisma.template.upsert({
      where: { id: template.id },
      create: {
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        teamId: null,
        nodes: graph.nodes as never,
        edges: graph.edges as never,
      },
      update: {
        name: template.name,
        description: template.description,
        category: template.category,
        nodes: graph.nodes as never,
        edges: graph.edges as never,
      },
    });
  }
}
