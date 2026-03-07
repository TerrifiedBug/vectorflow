import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { importVectorConfig } from "@/lib/config-generator";
import { decrypt } from "@/server/services/crypto";
import { encryptNodeConfig } from "@/server/services/config-crypto";
import { writeAuditLog } from "@/server/services/audit";
import { ComponentKind, Prisma } from "@/generated/prisma";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // 1. Find environments with bidirectional gitOps
  const environments = await prisma.environment.findMany({
    where: { gitOpsMode: "bidirectional", gitWebhookSecret: { not: null } },
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

  // 3. Parse GitHub push event
  const payload = JSON.parse(body);
  const ref: string | undefined = payload.ref; // "refs/heads/main"
  const branch = ref?.replace("refs/heads/", "");

  if (branch !== (matchedEnv.gitBranch ?? "main")) {
    return NextResponse.json(
      { message: "Branch mismatch, ignored" },
      { status: 200 },
    );
  }

  // 4. Find changed YAML files
  const commits = (payload.commits ?? []) as Array<{
    added?: string[];
    modified?: string[];
  }>;
  const changedFiles = new Set<string>();
  for (const commit of commits) {
    for (const f of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) changedFiles.add(f);
    }
  }

  if (changedFiles.size === 0) {
    return NextResponse.json({ message: "No YAML changes", processed: 0 });
  }

  // 5. For each changed file, fetch content and import
  const results: Array<{ file: string; status: string; error?: string }> = [];

  for (const file of changedFiles) {
    try {
      // Extract owner/repo from URL
      const repoUrl = matchedEnv.gitRepoUrl ?? "";
      const match = repoUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
      if (!match) {
        results.push({
          file,
          status: "skipped",
          error: "Cannot parse repo URL",
        });
        continue;
      }
      const repoPath = match[1];

      // Decrypt git token
      const token = matchedEnv.gitToken
        ? decrypt(matchedEnv.gitToken)
        : null;
      if (!token) {
        results.push({ file, status: "skipped", error: "No git token" });
        continue;
      }

      const contentRes = await fetch(
        `https://api.github.com/repos/${repoPath}/contents/${file}?ref=${branch}`,
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
      const pipelineName = file
        .replace(/^[^/]+\//, "")
        .replace(/\.(yaml|yml)$/, "");

      // Find or create pipeline by name in this environment
      let pipeline = await prisma.pipeline.findFirst({
        where: { environmentId: matchedEnv.id, name: pipelineName },
      });

      if (!pipeline) {
        pipeline = await prisma.pipeline.create({
          data: { name: pipelineName, environmentId: matchedEnv.id },
        });
      }

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

      // Write audit log for the import
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
          commitRef: payload.after ?? null,
          pusher: payload.pusher?.name ?? null,
        },
      });

      results.push({ file, status: "imported" });
    } catch (err) {
      results.push({ file, status: "error", error: String(err) });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
