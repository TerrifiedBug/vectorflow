import { expect } from "@playwright/test";
import { test } from "../fixtures/test.fixture";
import { TEST_USER } from "../helpers/constants";
import {
  createUserWithRole,
  prisma,
  readSeedResult,
} from "../helpers/scenario-utils";
import { generateNodeToken } from "../../src/server/services/agent-token";

test.describe("PR smoke e2e", () => {
  test.describe("authentication", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("authenticates and reaches protected routes", async ({
      page,
      loginPage,
    }) => {
      await loginPage.goto();
      await loginPage.login(TEST_USER.email, TEST_USER.password);
      await loginPage.expectRedirectedToDashboard();
      await expect(page).not.toHaveURL(/\/login/);
    });
  });

  test("creates, updates, deploys, and deletes a pipeline", async () => {
    const seed = await readSeedResult();
    const pipelineName = `PR Smoke ${Date.now()}`;
    const renamedPipeline = `${pipelineName} Updated`;

    const pipeline = await prisma.pipeline.create({
      data: {
        name: pipelineName,
        description: "PR smoke CRUD fixture",
        environmentId: seed.environmentId,
        isDraft: true,
        createdById: seed.userId,
        nodes: {
          create: [
            {
              componentKey: "demo_logs_source",
              displayName: "Demo Logs",
              componentType: "demo_logs",
              kind: "SOURCE",
              config: { format: "syslog", interval: 1 },
              positionX: 100,
              positionY: 200,
            },
          ],
        },
      },
      include: { nodes: true },
    });

    await prisma.pipeline.update({
      where: { id: pipeline.id },
      data: { name: renamedPipeline },
    });
    await prisma.pipelineVersion.create({
      data: {
        pipelineId: pipeline.id,
        version: 1,
        configYaml: "sources:\n  demo_logs_source:\n    type: demo_logs\n",
        nodesSnapshot: pipeline.nodes,
        edgesSnapshot: [],
        createdById: seed.userId,
      },
    });
    await prisma.pipeline.update({
      where: { id: pipeline.id },
      data: { deployedAt: new Date(), isDraft: false },
    });

    await expect(
      prisma.pipeline.findFirst({
        where: {
          id: pipeline.id,
          isDraft: false,
          name: renamedPipeline,
          deployedAt: { not: null },
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ id: pipeline.id }));

    await prisma.pipeline.delete({ where: { id: pipeline.id } });
    await expect(
      prisma.pipeline.findUnique({ where: { id: pipeline.id } }),
    ).resolves.toBeNull();
  });

  test.describe("settings RBAC", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("enforces settings RBAC for non-admin users", async ({
      loginPage,
      sidebar,
    }) => {
      const viewer = await createUserWithRole("VIEWER");

      await loginPage.goto();
      await loginPage.login(viewer.email, viewer.password);
      await loginPage.expectRedirectedToDashboard();

      await expect(sidebar.getNavLink("Settings")).not.toBeVisible();
    });
  });

  test("serves agent config and accepts heartbeat updates", async ({
    request,
  }) => {
    const seed = await readSeedResult();
    const nodeToken = await generateNodeToken();
    const configYaml = [
      "sources:",
      "  demo_logs_source:",
      "    type: demo_logs",
      "    format: syslog",
      "    interval: 1",
      "transforms:",
      "  remap_transform:",
      "    type: remap",
      "    inputs:",
      "      - demo_logs_source",
      "    source: . = parse_syslog!(.message)",
      "sinks:",
      "  blackhole_sink:",
      "    type: blackhole",
      "    inputs:",
      "      - remap_transform",
      "    print_interval_secs: 1",
    ].join("\n");

    await prisma.vectorNode.update({
      where: { id: seed.nodeId },
      data: {
        nodeTokenHash: nodeToken.hash,
        status: "UNREACHABLE",
      },
    });
    await prisma.pipeline.update({
      where: { id: seed.pipelineId },
      data: {
        isDraft: false,
        deployedAt: new Date(),
      },
    });
    await prisma.pipelineVersion.updateMany({
      where: { pipelineId: seed.pipelineId, version: 1 },
      data: { configYaml },
    });

    const authHeaders = {
      authorization: `Bearer ${nodeToken.token}`,
    };

    const configResponse = await request.get("/api/agent/config", {
      headers: authHeaders,
    });
    expect(configResponse.ok()).toBeTruthy();

    const configBody = (await configResponse.json()) as {
      pipelines: Array<{
        checksum: string;
        pipelineId: string;
        pipelineName: string;
      }>;
      pollIntervalMs: number;
      pushUrl: string;
    };
    expect(configBody.pollIntervalMs).toEqual(expect.any(Number));
    expect(configBody.pushUrl).toContain("/api/agent/push");
    const pipelineConfig = configBody.pipelines.find(
      (pipeline) => pipeline.pipelineId === seed.pipelineId,
    );
    expect(pipelineConfig).toEqual(
      expect.objectContaining({
        checksum: expect.any(String),
        pipelineId: seed.pipelineId,
        pipelineName: "E2E Test Pipeline",
      }),
    );

    const heartbeatResponse = await request.post("/api/agent/heartbeat", {
      headers: authHeaders,
      data: {
        agentVersion: "1.0.1-smoke",
        vectorVersion: "0.42.1",
        deploymentMode: "STANDALONE",
        pipelines: [
          {
            pipelineId: seed.pipelineId,
            version: 1,
            status: "RUNNING",
            eventsIn: 10,
            eventsOut: 10,
            errorsTotal: 0,
            configChecksum: pipelineConfig?.checksum,
          },
        ],
        hostMetrics: {
          memoryTotalBytes: 1024,
          memoryUsedBytes: 512,
          cpuSecondsTotal: 100,
          cpuSecondsIdle: 80,
        },
      },
    });
    expect(heartbeatResponse.ok()).toBeTruthy();
    await expect(heartbeatResponse).toBeOK();

    const updatedNode = await prisma.vectorNode.findUniqueOrThrow({
      where: { id: seed.nodeId },
      select: {
        agentVersion: true,
        lastHeartbeat: true,
        status: true,
        vectorVersion: true,
      },
    });
    expect(updatedNode).toMatchObject({
      agentVersion: "1.0.1-smoke",
      status: "HEALTHY",
      vectorVersion: "0.42.1",
    });
    expect(updatedNode.lastHeartbeat).toBeInstanceOf(Date);

    const pipelineStatus = await prisma.nodePipelineStatus.findUniqueOrThrow({
      where: {
        nodeId_pipelineId: {
          nodeId: seed.nodeId,
          pipelineId: seed.pipelineId,
        },
      },
      select: {
        configChecksum: true,
        status: true,
      },
    });
    expect(pipelineStatus).toEqual({
      configChecksum: pipelineConfig?.checksum,
      status: "RUNNING",
    });
  });
});
