import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { createVersion, deployFromVersion } from "@/server/services/pipeline-version";
import { fireEventAlert } from "@/server/services/event-alerts";
import { broadcastSSE } from "@/server/services/sse-broadcast";
import { pushRegistry } from "@/server/services/push-registry";
import { generateVectorYaml } from "@/lib/config-generator";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { TRPCError } from "@trpc/server";

// ─── Constants ──────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;

// ─── StagedRolloutService ───────────────────────────────────────────────────

export class StagedRolloutService {
  private timer: ReturnType<typeof setInterval> | null = null;

  init(): void {
    console.log("[staged-rollout] Initializing staged rollout service");
    this.start();
  }

  start(): void {
    this.timer = setInterval(
      this.checkHealthWindows.bind(this),
      POLL_INTERVAL_MS,
    );
    this.timer.unref();
    console.log(
      `[staged-rollout] Poll loop started (every ${POLL_INTERVAL_MS / 1000}s)`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[staged-rollout] Poll loop stopped");
    }
  }

  /**
   * Poll loop: find rollouts whose health-check window has expired
   * and transition them from CANARY_DEPLOYED to HEALTH_CHECK.
   */
  async checkHealthWindows(): Promise<void> {
    try {
      const now = new Date();
      const expiredRollouts = await prisma.stagedRollout.findMany({
        where: {
          status: "CANARY_DEPLOYED",
          healthCheckExpiresAt: { lte: now },
        },
        include: {
          pipeline: { select: { name: true, environmentId: true } },
        },
      });

      if (expiredRollouts.length === 0) return;

      console.log(
        `[staged-rollout] Found ${expiredRollouts.length} rollout(s) with expired health-check window`,
      );

      for (const rollout of expiredRollouts) {
        try {
          await prisma.stagedRollout.update({
            where: { id: rollout.id },
            data: { status: "HEALTH_CHECK" },
          });

          broadcastSSE(
            {
              type: "pipeline_status",
              pipelineId: rollout.pipelineId,
              action: "canary_health_check_ready",
              message: `Health-check window expired for pipeline "${rollout.pipeline.name}" — review canary health`,
              timestamp: Date.now(),
            },
            rollout.pipeline.environmentId,
          );

          console.log(
            `[staged-rollout] Rollout ${rollout.id} transitioned to HEALTH_CHECK`,
          );
        } catch (err) {
          console.error(
            `[staged-rollout] Error transitioning rollout ${rollout.id}:`,
            err,
          );
        }
      }
    } catch (err) {
      console.error(
        "[staged-rollout] Error in checkHealthWindows poll:",
        err,
      );
    }
  }

  /**
   * Create a staged canary rollout for a pipeline.
   *
   * Deploys a new version only to canary nodes (matching canarySelector labels),
   * then waits for a health-check window before the user can broaden or rollback.
   */
  async createRollout(
    pipelineId: string,
    userId: string,
    canarySelector: Record<string, string>,
    healthCheckWindowMinutes: number,
    changelog?: string,
  ): Promise<{ rolloutId: string }> {
    // Guard: no active rollout for this pipeline
    const existing = await prisma.stagedRollout.findFirst({
      where: {
        pipelineId,
        status: { in: ["CANARY_DEPLOYED", "HEALTH_CHECK"] },
      },
    });
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "An active staged rollout already exists for this pipeline",
      });
    }

    // Fetch pipeline with environment
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: pipelineId },
      include: {
        nodes: true,
        edges: true,
        environment: { select: { id: true, name: true } },
      },
    });
    if (!pipeline) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Pipeline not found",
      });
    }

    // Query all nodes in the environment
    const allNodes = await prisma.vectorNode.findMany({
      where: { environmentId: pipeline.environmentId },
      select: { id: true, labels: true },
    });

    // Compute canary nodes by matching canarySelector labels
    const selectorEntries = Object.entries(canarySelector);
    const canaryNodeIds: string[] = [];
    const remainingNodeIds: string[] = [];

    for (const node of allNodes) {
      const labels = (node.labels as Record<string, string>) ?? {};
      const matches = selectorEntries.every(([k, v]) => labels[k] === v);
      if (matches) {
        canaryNodeIds.push(node.id);
      } else {
        remainingNodeIds.push(node.id);
      }
    }

    if (canaryNodeIds.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No nodes match the canary selector",
      });
    }

    // Fetch 2 most recent PipelineVersions
    const versions = await prisma.pipelineVersion.findMany({
      where: { pipelineId },
      orderBy: { version: "desc" },
      take: 2,
      select: { id: true, version: true },
    });

    const previousVersionId = versions.length >= 2 ? versions[1]!.id : null;

    // Generate YAML config from the pipeline's current state
    const flowNodes = pipeline.nodes.map((n) => ({
      id: n.id,
      type: n.kind.toLowerCase(),
      position: { x: n.positionX, y: n.positionY },
      data: {
        componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
        componentKey: n.componentKey,
        config: decryptNodeConfig(
          n.componentType,
          (n.config as Record<string, unknown>) ?? {},
        ),
        disabled: n.disabled,
      },
    }));

    const flowEdges = pipeline.edges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
    }));

    const gc = pipeline.globalConfig as Record<string, unknown> | null;
    const logLevel = (gc?.log_level as string) ?? null;

    const configYaml = generateVectorYaml(
      flowNodes as Parameters<typeof generateVectorYaml>[0],
      flowEdges as Parameters<typeof generateVectorYaml>[1],
      gc,
    );

    const nodesSnapshot = pipeline.nodes.map((n) => ({
      id: n.id,
      componentKey: n.componentKey,
      displayName: n.displayName,
      componentType: n.componentType,
      kind: n.kind,
      config: n.config,
      positionX: n.positionX,
      positionY: n.positionY,
      disabled: n.disabled,
    }));
    const edgesSnapshot = pipeline.edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourcePort: e.sourcePort,
    }));

    // Create a new version (canary version)
    const canaryVersion = await createVersion(
      pipelineId,
      configYaml,
      userId,
      changelog ?? "Canary deploy",
      logLevel,
      gc,
      nodesSnapshot,
      edgesSnapshot,
    );

    // Send push notifications ONLY to canary nodes
    for (const nodeId of canaryNodeIds) {
      pushRegistry.send(nodeId, {
        type: "config_changed",
        pipelineId,
        reason: "canary_deploy",
      });
    }

    // Create StagedRollout record
    const now = new Date();
    const healthCheckExpiresAt = new Date(
      now.getTime() + healthCheckWindowMinutes * 60 * 1000,
    );

    const rollout = await prisma.stagedRollout.create({
      data: {
        pipelineId,
        environmentId: pipeline.environmentId,
        canaryVersionId: canaryVersion.id,
        previousVersionId,
        canarySelector,
        originalSelector: pipeline.nodeSelector
          ? (pipeline.nodeSelector as Prisma.InputJsonValue)
          : Prisma.DbNull,
        canaryNodeIds,
        remainingNodeIds,
        status: "CANARY_DEPLOYED",
        healthCheckWindowMinutes,
        healthCheckExpiresAt,
        createdById: userId,
      },
    });

    // Fire event alert
    await fireEventAlert("deploy_completed", pipeline.environmentId, {
      message: `Canary deploy started for pipeline "${pipeline.name}" — ${canaryNodeIds.length} canary node(s), ${remainingNodeIds.length} remaining`,
      pipelineId,
    });

    // Broadcast SSE event
    broadcastSSE(
      {
        type: "pipeline_status",
        pipelineId,
        action: "canary_deployed",
        message: `Canary deploy started for pipeline "${pipeline.name}"`,
        timestamp: Date.now(),
      },
      pipeline.environmentId,
    );

    console.log(
      `[staged-rollout] Created rollout ${rollout.id} for pipeline ${pipelineId} — ${canaryNodeIds.length} canary, ${remainingNodeIds.length} remaining`,
    );

    return { rolloutId: rollout.id };
  }

  /**
   * Broaden a canary rollout to all remaining nodes.
   * Only allowed when status is HEALTH_CHECK (health-check window has expired).
   */
  async broadenRollout(rolloutId: string): Promise<void> {
    const rollout = await prisma.stagedRollout.findUnique({
      where: { id: rolloutId },
      include: {
        pipeline: { select: { name: true, environmentId: true } },
      },
    });

    if (!rollout) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Staged rollout not found",
      });
    }

    if (rollout.status !== "HEALTH_CHECK") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot broaden rollout in status "${rollout.status}" — must be in HEALTH_CHECK`,
      });
    }

    // Send config_changed push to remaining nodes
    const remainingNodeIds = (rollout.remainingNodeIds as string[]) ?? [];
    for (const nodeId of remainingNodeIds) {
      pushRegistry.send(nodeId, {
        type: "config_changed",
        pipelineId: rollout.pipelineId,
        reason: "canary_broadened",
      });
    }

    // Update status
    await prisma.stagedRollout.update({
      where: { id: rolloutId },
      data: {
        status: "BROADENED",
        broadenedAt: new Date(),
      },
    });

    // Fire event alert
    await fireEventAlert("deploy_completed", rollout.pipeline.environmentId, {
      message: `Canary broadened to all nodes for pipeline "${rollout.pipeline.name}"`,
      pipelineId: rollout.pipelineId,
    });

    // Broadcast SSE event
    broadcastSSE(
      {
        type: "pipeline_status",
        pipelineId: rollout.pipelineId,
        action: "canary_broadened",
        message: `Canary broadened to all nodes for pipeline "${rollout.pipeline.name}"`,
        timestamp: Date.now(),
      },
      rollout.pipeline.environmentId,
    );

    console.log(
      `[staged-rollout] Broadened rollout ${rolloutId} — pushed to ${remainingNodeIds.length} remaining node(s)`,
    );
  }

  /**
   * Rollback a canary rollout — deploy the previous version to canary nodes.
   * Allowed from CANARY_DEPLOYED (early rollback) or HEALTH_CHECK status.
   */
  async rollbackRollout(rolloutId: string): Promise<void> {
    const rollout = await prisma.stagedRollout.findUnique({
      where: { id: rolloutId },
      include: {
        pipeline: { select: { name: true, environmentId: true } },
        canaryVersion: { select: { createdById: true } },
      },
    });

    if (!rollout) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Staged rollout not found",
      });
    }

    if (!["CANARY_DEPLOYED", "HEALTH_CHECK"].includes(rollout.status)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot rollback rollout in status "${rollout.status}" — must be CANARY_DEPLOYED or HEALTH_CHECK`,
      });
    }

    // If there's a previous version, deploy it (pushes to all matching nodes via pipeline's nodeSelector)
    if (rollout.previousVersionId) {
      const userId = rollout.canaryVersion.createdById ?? rollout.createdById;
      await deployFromVersion(
        rollout.pipelineId,
        rollout.previousVersionId,
        userId,
        `Canary rollback for pipeline`,
      );
    }

    // Update status
    await prisma.stagedRollout.update({
      where: { id: rolloutId },
      data: {
        status: "ROLLED_BACK",
        rolledBackAt: new Date(),
      },
    });

    // Fire event alert
    await fireEventAlert("deploy_completed", rollout.pipeline.environmentId, {
      message: `Canary deploy rolled back for pipeline "${rollout.pipeline.name}"`,
      pipelineId: rollout.pipelineId,
    });

    // Broadcast SSE event
    broadcastSSE(
      {
        type: "pipeline_status",
        pipelineId: rollout.pipelineId,
        action: "canary_rolled_back",
        message: `Canary deploy rolled back for pipeline "${rollout.pipeline.name}"`,
        timestamp: Date.now(),
      },
      rollout.pipeline.environmentId,
    );

    console.log(
      `[staged-rollout] Rolled back rollout ${rolloutId}${rollout.previousVersionId ? ` to version ${rollout.previousVersionId}` : " (no previous version)"}`,
    );
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const stagedRolloutService = new StagedRolloutService();

export function initStagedRolloutService(): void {
  stagedRolloutService.init();
}
