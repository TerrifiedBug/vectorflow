import { test, expect } from "@playwright/test";
import { prisma, readSeedResult } from "../helpers/scenario-utils";
import { saveGraphComponents } from "../../src/server/services/pipeline-graph";
import { addDependency } from "../../src/server/services/pipeline-dependency";

test.describe("Pipeline Validation", () => {
  test("should reject invalid shared component references", async () => {
    const seed = await readSeedResult();

    await expect(
      prisma.$transaction((tx) =>
        saveGraphComponents(tx, {
          pipelineId: seed.pipelineId,
          userId: seed.userId,
          globalConfig: null,
          nodes: [
            {
              componentKey: "bad_shared_ref",
              displayName: "Bad Shared",
              componentType: "demo_logs",
              kind: "SOURCE",
              config: {},
              positionX: 100,
              positionY: 100,
              disabled: false,
              sharedComponentId: "does-not-exist",
            },
          ],
          edges: [],
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("not found"),
    });
  });

  test("should detect direct dependency cycles", async () => {
    const seed = await readSeedResult();

    const p1 = await prisma.pipeline.create({
      data: {
        name: `Cycle A ${Date.now()}`,
        environmentId: seed.environmentId,
        isDraft: true,
      },
    });
    const p2 = await prisma.pipeline.create({
      data: {
        name: `Cycle B ${Date.now()}`,
        environmentId: seed.environmentId,
        isDraft: true,
      },
    });

    await addDependency(p1.id, p2.id);

    await expect(addDependency(p2.id, p1.id)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("circular dependency"),
    });
  });

  test("should detect transitive dependency cycles", async () => {
    const seed = await readSeedResult();

    const p1 = await prisma.pipeline.create({
      data: {
        name: `Transitive A ${Date.now()}`,
        environmentId: seed.environmentId,
        isDraft: true,
      },
    });
    const p2 = await prisma.pipeline.create({
      data: {
        name: `Transitive B ${Date.now()}`,
        environmentId: seed.environmentId,
        isDraft: true,
      },
    });
    const p3 = await prisma.pipeline.create({
      data: {
        name: `Transitive C ${Date.now()}`,
        environmentId: seed.environmentId,
        isDraft: true,
      },
    });

    await addDependency(p1.id, p2.id);
    await addDependency(p2.id, p3.id);

    await expect(addDependency(p3.id, p1.id)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("circular dependency"),
    });
  });
});
