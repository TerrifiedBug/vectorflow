import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { importVectorConfig } from "@/lib/config-generator";
import { decrypt } from "@/server/services/crypto";
import { encryptNodeConfig } from "@/server/services/config-crypto";
import { writeAuditLog } from "@/server/services/audit";
import { ComponentKind, Prisma } from "@/generated/prisma";
import { executePromotion } from "@/server/services/promotion-service";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const eventType = req.headers.get("x-github-event") ?? "push";

  // Handle GitHub ping (sent when webhook is first registered)
  if (eventType === "ping") {
    return NextResponse.json({ message: "pong" }, { status: 200 });
  }

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // 1. Find environments with gitOps webhook configured.
  //    Includes both bidirectional (push) and promotion (PR-based) modes.
  const environments = await prisma.environment.findMany({
    where: {
      gitOpsMode: { in: ["bidirectional", "promotion"] },
      gitWebhookSecret: { not: null },
    },
  });

  // 2. Verify HMAC signature against each environment's webhook secret
  let matchedEnv = null;
  for (const env of environments) {
    if (!env.gitWebhookSecret) continue;
    const webhookSecret = decrypt(env.gitWebhookSecret);
    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");

    // timingSafeEqual requires equal-length buffers
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
      matchedEnv = env;
      break;
    }
  }

  if (!matchedEnv) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 3. Parse payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  // ─── pull_request event: GitOps promotion merge trigger ──────────────────
  if (eventType === "pull_request") {
    // Only handle closed+merged — reject closed-without-merge
    if (payload.action !== "closed") {
      return NextResponse.json({ message: "Not a closed event, ignored" }, { status: 200 });
    }
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    if (!pr?.merged) {
      return NextResponse.json({ message: "PR closed without merge, ignored" }, { status: 200 });
    }

    // Extract VF promotion request ID from PR body
    const prBody = (pr.body as string) ?? "";
    const match = prBody.match(/<!-- vf-promotion-request-id: ([a-z0-9]+) -->/);
    if (!match) {
      return NextResponse.json(
        { message: "No VectorFlow promotion ID in PR body, ignored" },
        { status: 200 },
      );
    }
    const promotionRequestId = match[1];

    // Atomic idempotency guard — prevents double-deploy on GitHub retry
    const updated = await prisma.promotionRequest.updateMany({
      where: { id: promotionRequestId, status: "AWAITING_PR_MERGE" },
      data: { status: "DEPLOYING" },
    });

    if (updated.count === 0) {
      // Already deployed, not found, or not in the right state — safe to ignore
      return NextResponse.json(
        { message: "Promotion already processed or not found" },
        { status: 200 },
      );
    }

    // Load the original promoter for audit attribution
    const promotionRequest = await prisma.promotionRequest.findUnique({
      where: { id: promotionRequestId },
      select: { promotedById: true },
    });

    // Execute the promotion (the promoter is the logical actor)
    const executorId = promotionRequest?.promotedById ?? "system";
    await executePromotion(promotionRequestId, executorId);

    return NextResponse.json({ deployed: true, promotionRequestId });
  }

  // ─── push event: Bidirectional GitOps config import ──────────────────────
  const ref: string | undefined = payload.ref as string | undefined; // "refs/heads/main"
  const branch = ref?.replace("refs/heads/", "");

  // Sanitize branch — only allow alphanumeric, slashes, dashes, dots, underscores
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

  // 4. Find changed YAML files scoped to this environment's directory prefix
  const envSlug = matchedEnv.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const commits = (payload.commits ?? []) as Array<{
    added?: string[];
    modified?: string[];
  }>;
  const changedFiles = new Set<string>();
  for (const commit of commits) {
    for (const f of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
      if (
        (f.endsWith(".yaml") || f.endsWith(".yml")) &&
        f.startsWith(`${envSlug}/`)
      ) {
        changedFiles.add(f);
      }
    }
  }

  if (changedFiles.size === 0) {
    return NextResponse.json({ message: "No YAML changes", processed: 0 });
  }

  // 5. Extract owner/repo and decrypt token once (invariant across files)
  const repoUrl = matchedEnv.gitRepoUrl ?? "";
  const repoMatch = repoUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!repoMatch) {
    return NextResponse.json(
      { error: "Cannot parse repo URL" },
      { status: 422 },
    );
  }
  const repoPath = repoMatch[1];

  // Validate repoPath is a safe owner/repo format (no path traversal or encoded chars)
  const REPO_PATH_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
  if (!REPO_PATH_RE.test(repoPath)) {
    return NextResponse.json(
      { error: "Invalid repository path" },
      { status: 422 },
    );
  }

  const token = matchedEnv.gitToken ? decrypt(matchedEnv.gitToken) : null;
  if (!token) {
    return NextResponse.json(
      { error: "No git token configured" },
      { status: 422 },
    );
  }

  // 6. For each changed file, fetch content and import
  const results: Array<{ file: string; status: string; error?: string }> = [];

  for (const file of changedFiles) {
    try {
      // Sanitize file path — reject traversal sequences and non-printable chars
      if (file.includes("..") || file.startsWith("/") || /[^\x20-\x7E]/.test(file)) {
        results.push({ file, status: "skipped", error: "Invalid file path" });
        continue;
      }

      // Build the URL safely with encoded path components
      const encodedFile = file.split("/").map(encodeURIComponent).join("/");
      const contentRes = await fetch(
        `https://api.github.com/repos/${repoPath}/contents/${encodedFile}?ref=${encodeURIComponent(branch)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.raw",
          },
        },
      );
      if (!contentRes.ok) {
        results.push({
          file,
          status: "error",
          error: `GitHub API ${contentRes.status}`,
        });
        continue;
      }
      const content = await contentRes.text();

      // Derive pipeline name from filename (strip directory prefix and extension)
      // Use only the basename (last path segment) to avoid slashes in the name
      const basename = file.split("/").pop() ?? file;
      const pipelineName = basename.replace(/\.(yaml|yml)$/, "");

      // Validate the pipeline name matches the schema used by the tRPC router
      const PIPELINE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/;
      if (!pipelineName || pipelineName.length > 100 || !PIPELINE_NAME_RE.test(pipelineName)) {
        results.push({
          file,
          status: "skipped",
          error: `Invalid pipeline name "${pipelineName}" — must start with alphanumeric and contain only letters, numbers, spaces, hyphens, underscores`,
        });
        continue;
      }

      // Find or create pipeline by name in this environment (atomic)
      // Use a serializable transaction to prevent concurrent webhooks from
      // racing and creating duplicate pipelines with the same name.
      const pipeline = await prisma.$transaction(async (tx) => {
        const existing = await tx.pipeline.findFirst({
          where: { environmentId: matchedEnv.id, name: pipelineName },
        });
        if (existing) return existing;
        return tx.pipeline.create({
          data: { name: pipelineName, environmentId: matchedEnv.id },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      // Import config into pipeline graph nodes/edges
      // Only YAML files are collected (see filter above), so format is always "yaml"
      const { nodes, edges, globalConfig } = importVectorConfig(content, "yaml");

      // Map the component kind strings to the Prisma enum
      const kindMap: Record<string, ComponentKind> = {
        source: ComponentKind.SOURCE,
        transform: ComponentKind.TRANSFORM,
        sink: ComponentKind.SINK,
      };

      // Save graph within a transaction (same pattern as pipeline.saveGraph)
      await prisma.$transaction(async (tx) => {
        await tx.pipelineEdge.deleteMany({
          where: { pipelineId: pipeline!.id },
        });
        await tx.pipelineNode.deleteMany({
          where: { pipelineId: pipeline!.id },
        });

        // Create nodes
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

        // Create edges
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

        // Update pipeline globalConfig
        await tx.pipeline.update({
          where: { id: pipeline!.id },
          data: {
            globalConfig: (globalConfig ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });
      });

      // Write audit log for the import — failures must not mask a successful transaction
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
            commitRef: (payload.after as string) ?? null,
            pusher: (payload.pusher as { name?: string } | undefined)?.name ?? null,
          },
        });
      } catch (auditErr) {
        console.error("Failed to write audit log for gitops import:", auditErr);
      }

      results.push({ file, status: "imported" });
    } catch (err) {
      results.push({ file, status: "error", error: String(err) });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
