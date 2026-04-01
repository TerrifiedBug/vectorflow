import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { importVectorConfig } from "@/lib/config-generator";
import { decrypt } from "@/server/services/crypto";
import { encryptNodeConfig } from "@/server/services/config-crypto";
import { writeAuditLog } from "@/server/services/audit";
import { ComponentKind, Prisma } from "@/generated/prisma";
import { executePromotion } from "@/server/services/promotion-service";
import { getProvider } from "@/server/services/git-providers";
import type { GitWebhookEvent } from "@/server/services/git-providers";
import { toFilenameSlug } from "@/server/services/git-sync";
import { checkIpRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { errorLog } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const rateLimited = checkIpRateLimit(req, "webhook", 30);
  if (rateLimited) return rateLimited;

  const body = await req.text();

  // 1. Find environments with gitOps webhook configured.
  const environments = await prisma.environment.findMany({
    where: {
      gitOpsMode: { in: ["bidirectional", "promotion"] },
      gitWebhookSecret: { not: null },
    },
  });

  // 2. Verify webhook signature against each environment using the correct provider
  let matchedEnv = null;
  for (const env of environments) {
    if (!env.gitWebhookSecret) continue;

    const provider = getProvider(env);
    if (!provider) continue;

    const webhookSecret = decrypt(env.gitWebhookSecret);
    if (provider.verifyWebhookSignature(req.headers, body, webhookSecret)) {
      matchedEnv = env;
      break;
    }
  }

  if (!matchedEnv) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 3. Resolve the provider for the matched environment
  const provider = getProvider(matchedEnv);
  if (!provider) {
    return NextResponse.json(
      { error: "Cannot determine git provider for environment" },
      { status: 422 },
    );
  }

  // 4. Parse the webhook payload using the provider
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const event: GitWebhookEvent = provider.parseWebhookEvent(req.headers, payload);

  // Handle ping events
  if (event.type === "ping") {
    return NextResponse.json({ message: "pong" }, { status: 200 });
  }

  // --- Pull request merged: GitOps promotion trigger ---
  if (event.type === "pull_request_merged") {
    const prBody = event.prBody ?? "";
    const match = prBody.match(/<!-- vf-promotion-request-id: ([a-z0-9]+) -->/);
    if (!match) {
      return NextResponse.json(
        { message: "No VectorFlow promotion ID in PR body, ignored" },
        { status: 200 },
      );
    }
    const promotionRequestId = match[1];

    // Atomic idempotency guard
    const updated = await prisma.promotionRequest.updateMany({
      where: { id: promotionRequestId, status: "AWAITING_PR_MERGE" },
      data: { status: "DEPLOYING" },
    });

    if (updated.count === 0) {
      return NextResponse.json(
        { message: "Promotion already processed or not found" },
        { status: 200 },
      );
    }

    const promotionRequest = await prisma.promotionRequest.findUnique({
      where: { id: promotionRequestId },
      select: { promotedById: true },
    });

    const executorId = promotionRequest?.promotedById ?? "system";
    await executePromotion(promotionRequestId, executorId);

    return NextResponse.json({ deployed: true, promotionRequestId });
  }

  // --- Pull request closed without merge ---
  if (event.type === "pull_request_closed") {
    return NextResponse.json(
      { message: "PR closed without merge, ignored" },
      { status: 200 },
    );
  }

  // --- Push event: Bidirectional GitOps config import ---
  if (event.type !== "push") {
    return NextResponse.json(
      { message: `Event type "${event.type}" not handled` },
      { status: 200 },
    );
  }

  const branch = event.branch;
  const BRANCH_RE = /^[a-zA-Z0-9\/_.-]+$/;
  if (!branch || !BRANCH_RE.test(branch)) {
    return NextResponse.json(
      { error: "Invalid branch ref" },
      { status: 400 },
    );
  }

  if (branch !== (matchedEnv.gitBranch ?? "main")) {
    return NextResponse.json(
      { message: "Branch mismatch, ignored" },
      { status: 200 },
    );
  }

  // Find changed YAML files scoped to this environment's directory prefix
  const envSlug = toFilenameSlug(matchedEnv.name);
  const changedFiles = new Set<string>();
  for (const commit of event.commits) {
    for (const f of [...commit.added, ...commit.modified]) {
      if (
        (f.endsWith(".yaml") || f.endsWith(".yml")) &&
        f.startsWith(`${envSlug}/`)
      ) {
        changedFiles.add(f);
      }
    }
  }

  // For Bitbucket: push events may not include file-level changes.
  // If we got commits but no changed files, fetch the diffstat.
  if (changedFiles.size === 0 && event.commits.length > 0 && provider.name === "bitbucket" && event.afterSha) {
    // Bitbucket push events don't include file-level changes — fetch via diffstat API
    const bbToken = matchedEnv.gitToken ? decrypt(matchedEnv.gitToken) : null;
    if (bbToken && matchedEnv.gitRepoUrl) {
      const { BitbucketProvider } = await import("@/server/services/git-providers/bitbucket");
      const bbProvider = new BitbucketProvider();
      const diffFiles = await bbProvider.fetchCommitDiffstat(matchedEnv.gitRepoUrl, bbToken, event.afterSha);
      for (const f of diffFiles) {
        if (
          (f.path.endsWith(".yaml") || f.path.endsWith(".yml")) &&
          f.path.startsWith(`${envSlug}/`) &&
          f.status !== "removed"
        ) {
          changedFiles.add(f.path);
        }
      }
    }
  }

  if (changedFiles.size === 0) {
    return NextResponse.json({ message: "No YAML changes", processed: 0 });
  }

  // Decrypt token once for file fetching
  const token = matchedEnv.gitToken ? decrypt(matchedEnv.gitToken) : null;
  if (!token || !matchedEnv.gitRepoUrl) {
    return NextResponse.json(
      { error: "No git token or repo URL configured" },
      { status: 422 },
    );
  }

  // Check if approval is required for bidirectional imports
  const requiresApproval = matchedEnv.requireDeployApproval;

  // For each changed file, fetch content and import
  const results: Array<{ file: string; status: string; error?: string }> = [];

  for (const file of changedFiles) {
    try {
      // Sanitize file path
      if (file.includes("..") || file.startsWith("/") || /[^\x20-\x7E]/.test(file)) {
        results.push({ file, status: "skipped", error: "Invalid file path" });
        continue;
      }

      const content = await provider.fetchFileContent(
        matchedEnv.gitRepoUrl,
        token,
        branch,
        file,
      );

      // Derive pipeline name from filename
      const basename = file.split("/").pop() ?? file;
      const pipelineName = basename.replace(/\.(yaml|yml)$/, "");

      const PIPELINE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/;
      if (!pipelineName || pipelineName.length > 100 || !PIPELINE_NAME_RE.test(pipelineName)) {
        results.push({
          file,
          status: "skipped",
          error: `Invalid pipeline name "${pipelineName}"`,
        });
        continue;
      }

      // Match by gitPath first, then by name
      const pipeline = await prisma.$transaction(async (tx) => {
        // Try matching by gitPath
        const byPath = await tx.pipeline.findFirst({
          where: { environmentId: matchedEnv.id, gitPath: file },
        });
        if (byPath) return byPath;

        // Fallback: match by name
        const existing = await tx.pipeline.findFirst({
          where: { environmentId: matchedEnv.id, name: pipelineName },
        });
        if (existing) {
          // Set gitPath if not already set
          if (!existing.gitPath) {
            await tx.pipeline.update({
              where: { id: existing.id },
              data: { gitPath: file },
            });
          }
          return existing;
        }

        // Create new pipeline with gitPath
        return tx.pipeline.create({
          data: {
            name: pipelineName,
            environmentId: matchedEnv.id,
            gitPath: file,
            isDraft: requiresApproval ? true : undefined,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      // Import config into pipeline graph
      const { nodes, edges, globalConfig } = importVectorConfig(content, "yaml");

      const kindMap: Record<string, ComponentKind> = {
        source: ComponentKind.SOURCE,
        transform: ComponentKind.TRANSFORM,
        sink: ComponentKind.SINK,
      };

      await prisma.$transaction(async (tx) => {
        await tx.pipelineEdge.deleteMany({ where: { pipelineId: pipeline!.id } });
        await tx.pipelineNode.deleteMany({ where: { pipelineId: pipeline!.id } });

        for (const node of nodes) {
          const data = node.data as {
            componentDef: { type: string; kind: string };
            componentKey: string;
            config: Record<string, unknown>;
          };
          const componentType = data.componentDef.type;
          const kind = kindMap[data.componentDef.kind] ?? ComponentKind.SOURCE;

          await tx.pipelineNode.create({
            data: {
              id: node.id,
              pipelineId: pipeline!.id,
              componentKey: data.componentKey,
              componentType,
              kind,
              config: encryptNodeConfig(
                componentType,
                data.config,
              ) as unknown as Prisma.InputJsonValue,
              positionX: node.position.x,
              positionY: node.position.y,
            },
          });
        }

        for (const edge of edges) {
          await tx.pipelineEdge.create({
            data: {
              id: edge.id,
              pipelineId: pipeline!.id,
              sourceNodeId: edge.source,
              targetNodeId: edge.target,
              sourcePort: (edge as { sourceHandle?: string }).sourceHandle ?? null,
            },
          });
        }

        await tx.pipeline.update({
          where: { id: pipeline!.id },
          data: {
            globalConfig: (globalConfig ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });
      });

      // If approval is required, create a DeployRequest instead of deploying immediately
      if (requiresApproval) {
        const { generateVectorYaml } = await import("@/lib/config-generator");
        const flowNodes = nodes.map((n) => ({
          id: n.id,
          type: (n.data as { componentDef: { kind: string } }).componentDef.kind,
          position: n.position,
          data: n.data,
        }));
        const flowEdges = edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          ...(("sourceHandle" in e && e.sourceHandle) ? { sourceHandle: e.sourceHandle as string } : {}),
        }));

        const configYaml = generateVectorYaml(
          flowNodes as Parameters<typeof generateVectorYaml>[0],
          flowEdges as Parameters<typeof generateVectorYaml>[1],
          globalConfig as Record<string, unknown> | null,
          null,
        );

        await prisma.deployRequest.create({
          data: {
            pipelineId: pipeline.id,
            environmentId: matchedEnv.id,
            requestedById: null,
            configYaml,
            changelog: `GitOps import from ${file} (commit: ${event.afterSha?.slice(0, 8) ?? "unknown"})`,
          },
        });

        results.push({ file, status: "imported_pending_approval" });
      } else {
        results.push({ file, status: "imported" });
      }

      // Audit log
      try {
        await writeAuditLog({
          userId: null,
          action: "gitops.pipeline.imported",
          entityType: "Pipeline",
          entityId: pipeline.id,
          environmentId: matchedEnv.id,
          teamId: matchedEnv.teamId,
          metadata: {
            file,
            branch,
            commitRef: event.afterSha ?? null,
            pusher: event.pusherName ?? null,
            provider: provider.name,
            requiresApproval,
          },
        });
      } catch (auditErr) {
        errorLog("gitops", "Failed to write audit log for gitops import", auditErr);
      }
    } catch (err) {
      // Write YAML import error to audit log for visibility
      try {
        await writeAuditLog({
          userId: null,
          action: "gitops.pipeline.import_failed",
          entityType: "Environment",
          entityId: matchedEnv.id,
          environmentId: matchedEnv.id,
          teamId: matchedEnv.teamId,
          metadata: {
            file,
            branch,
            commitRef: event.afterSha ?? null,
            error: String(err),
            provider: provider.name,
          },
        });
      } catch {
        // Don't mask the original error
      }
      results.push({ file, status: "error", error: String(err) });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
