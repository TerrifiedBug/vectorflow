import { expect } from "@playwright/test";
import { test } from "../fixtures/test.fixture";
import { TEST_ENVIRONMENT, TEST_NODE, TEST_USER } from "../helpers/constants";
import {
  createUserWithRole,
  prisma,
  readSeedResult,
} from "../helpers/scenario-utils";
import { generateNodeToken } from "../../src/server/services/agent-token";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("PR smoke e2e", () => {
  test("authenticates, creates, deploys, and observes fleet health", async ({
    page,
    loginPage,
    pipelinesPage,
    pipelineEditor,
    deployDialog,
    fleetPage,
  }) => {
    const pipelineName = `PR Smoke ${Date.now()}`;

    await loginPage.goto();
    await loginPage.login(TEST_USER.email, TEST_USER.password);
    await loginPage.expectRedirectedToDashboard();

    await page.goto("/pipelines/new");
    await page.locator(".react-flow").waitFor({ state: "visible" });

    await pipelineEditor.setName(pipelineName);
    await pipelineEditor.addNodeFromPalette("source", "demo_logs");
    await pipelineEditor.addNodeFromPalette("sink", "blackhole");
    await pipelineEditor.connectNodes("demo_logs", "blackhole");
    await pipelineEditor.save();
    await pipelineEditor.expectSaveSuccess();

    await pipelineEditor.clickDeploy();
    await deployDialog.expectOpen();
    await deployDialog.expectEnvironmentOption(TEST_ENVIRONMENT.name);
    await deployDialog.expectNodeListed(TEST_NODE.name);
    await deployDialog.clickDeploy();
    await deployDialog.waitForDeployComplete();

    await pipelinesPage.goto();
    await pipelinesPage.expectPipelineInList(pipelineName);
    await pipelinesPage.expectDeploymentBadge(pipelineName);

    await fleetPage.goto();
    await fleetPage.expectNodeInList(TEST_NODE.name);
    await fleetPage.expectNodeStatus(TEST_NODE.name, "Healthy");
  });

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
