export const runtime = "nodejs";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { streamCompletion } from "@/server/services/ai";
import { buildPipelineSystemPrompt } from "@/lib/ai/prompts";
import { writeAuditLog } from "@/server/services/audit";
import type { AiReviewResponse } from "@/lib/ai/types";
import { Prisma } from "@/generated/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    teamId: string;
    prompt: string;
    mode: "generate" | "review";
    currentYaml?: string;
    environmentName?: string;
    pipelineId?: string;
    conversationId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.teamId || !body.prompt || !body.mode) {
    return new Response(JSON.stringify({ error: "teamId, prompt, and mode are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (body.mode !== "generate" && body.mode !== "review") {
    return new Response(JSON.stringify({ error: "mode must be 'generate' or 'review'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify user is at least EDITOR on this team
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: session.user.id, teamId: body.teamId } },
  });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperAdmin: true },
  });

  if (!membership && !user?.isSuperAdmin) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (membership && membership.role === "VIEWER" && !user?.isSuperAdmin) {
    return new Response(JSON.stringify({ error: "EDITOR role required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate pipelineId for review mode
  if (body.mode === "review" && !body.pipelineId) {
    return new Response(JSON.stringify({ error: "pipelineId is required for review mode" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Conversation persistence (review mode only) ---
  let conversationId = body.conversationId;
  let priorMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  if (body.mode === "review" && body.pipelineId) {
    // Verify pipelineId belongs to the team
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: body.pipelineId },
      select: { environment: { select: { teamId: true } } },
    });
    if (!pipeline || pipeline.environment.teamId !== body.teamId) {
      return new Response(JSON.stringify({ error: "Pipeline not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!conversationId) {
      const conversation = await prisma.aiConversation.create({
        data: {
          pipelineId: body.pipelineId,
          createdById: session.user.id,
        },
      });
      conversationId = conversation.id;
    } else {
      // Verify conversationId belongs to this pipeline
      const existing = await prisma.aiConversation.findUnique({
        where: { id: conversationId },
        select: { pipelineId: true },
      });
      if (!existing || existing.pipelineId !== body.pipelineId) {
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    await prisma.aiMessage.create({
      data: {
        conversationId,
        role: "user",
        content: body.prompt,
        pipelineYaml: body.currentYaml ?? null,
        createdById: session.user.id,
      },
    });

    // Get most recent 10 messages (desc) then reverse to chronological order
    const history = await prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { role: true, content: true },
    });
    history.reverse();

    // Exclude the message we just saved (last user msg) — it goes as the current prompt
    priorMessages = history.slice(0, -1).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  }

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...priorMessages,
    { role: "user", content: body.prompt },
  ];

  const mode = body.mode;

  const systemPrompt = buildPipelineSystemPrompt({
    mode,
    currentYaml: body.currentYaml,
    environmentName: body.environmentName,
  });

  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (conversationId) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ conversationId })}\n\n`)
          );
        }

        await streamCompletion({
          teamId: body.teamId,
          systemPrompt,
          messages,
          onToken: (token) => {
            fullResponse += token;
            const data = JSON.stringify({ token });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          },
          signal: request.signal,
        });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));

        if (body.mode === "review" && conversationId) {
          let parsedSuggestions = null;
          try {
            const parsed: AiReviewResponse = JSON.parse(fullResponse);
            if (parsed.summary && Array.isArray(parsed.suggestions)) {
              parsedSuggestions = parsed.suggestions;
            }
          } catch {
            // Not valid JSON — store as raw text
          }

          prisma.aiMessage.create({
            data: {
              conversationId,
              role: "assistant",
              content: fullResponse,
              suggestions: (parsedSuggestions as unknown as Prisma.InputJsonValue) ?? undefined,
              createdById: session.user.id,
            },
          }).catch((err) => console.error("Failed to persist AI response:", err));

          const pipelineForAudit = await prisma.pipeline.findUnique({
            where: { id: body.pipelineId! },
            select: { environmentId: true, environment: { select: { teamId: true } } },
          });

          writeAuditLog({
            userId: session.user.id,
            action: "pipeline.ai_review",
            entityType: "Pipeline",
            entityId: body.pipelineId!,
            metadata: {
              conversationId,
              mode: body.mode,
              suggestionCount: parsedSuggestions?.length ?? 0,
            },
            teamId: pipelineForAudit?.environment.teamId ?? null,
            environmentId: pipelineForAudit?.environmentId ?? null,
            userEmail: session.user.email ?? null,
            userName: session.user.name ?? null,
          }).catch(() => {});
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "AI request failed";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
