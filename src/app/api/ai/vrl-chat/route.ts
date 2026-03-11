export const runtime = "nodejs";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { streamCompletion } from "@/server/services/ai";
import { buildVrlChatSystemPrompt } from "@/lib/ai/prompts";
import { writeAuditLog } from "@/server/services/audit";
import type { VrlChatResponse } from "@/lib/ai/vrl-suggestion-types";
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
    currentCode?: string;
    fields?: { name: string; type: string }[];
    componentType?: string;
    sourceTypes?: string[];
    pipelineId: string;
    componentKey: string;
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

  if (!body.teamId || !body.prompt || !body.pipelineId || !body.componentKey) {
    return new Response(
      JSON.stringify({ error: "teamId, prompt, pipelineId, and componentKey are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
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

  // Verify pipelineId belongs to the team
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: body.pipelineId },
    select: { environmentId: true, environment: { select: { teamId: true } } },
  });
  if (!pipeline || pipeline.environment.teamId !== body.teamId) {
    return new Response(JSON.stringify({ error: "Pipeline not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Conversation persistence ---
  let conversationId = body.conversationId;
  let priorMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  if (!conversationId) {
    const conversation = await prisma.aiConversation.create({
      data: {
        pipelineId: body.pipelineId,
        componentKey: body.componentKey,
        createdById: session.user.id,
      },
    });
    conversationId = conversation.id;
  } else {
    // Verify conversationId belongs to this pipeline + component
    const existing = await prisma.aiConversation.findUnique({
      where: { id: conversationId },
      select: { pipelineId: true, componentKey: true },
    });
    if (
      !existing ||
      existing.pipelineId !== body.pipelineId ||
      existing.componentKey !== body.componentKey
    ) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Save user message
  await prisma.aiMessage.create({
    data: {
      conversationId,
      role: "user",
      content: body.prompt,
      vrlCode: body.currentCode ?? null,
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

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...priorMessages,
    { role: "user", content: body.prompt },
  ];

  const systemPrompt = buildVrlChatSystemPrompt({
    fields: body.fields,
    currentCode: body.currentCode,
    componentType: body.componentType,
    sourceTypes: body.sourceTypes,
  });

  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ conversationId })}\n\n`),
        );

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

        // Persist assistant response
        let parsedSuggestions = null;
        try {
          const parsed: VrlChatResponse = JSON.parse(fullResponse);
          if (parsed.summary && Array.isArray(parsed.suggestions)) {
            parsedSuggestions = parsed.suggestions;
          }
        } catch {
          // Not valid JSON — store as raw text
        }

        try {
          await prisma.aiMessage.create({
            data: {
              conversationId: conversationId!,
              role: "assistant",
              content: fullResponse,
              suggestions: (parsedSuggestions as unknown as Prisma.InputJsonValue) ?? undefined,
              vrlCode: body.currentCode ?? null,
              createdById: session.user.id,
            },
          });
        } catch (err) {
          console.error("Failed to persist VRL AI response:", err);
        }

        writeAuditLog({
          userId: session.user.id,
          action: "pipeline.vrl_ai_chat",
          entityType: "Pipeline",
          entityId: body.pipelineId,
          metadata: {
            conversationId,
            componentKey: body.componentKey,
            suggestionCount: parsedSuggestions?.length ?? 0,
          },
          teamId: pipeline.environment.teamId,
          environmentId: pipeline.environmentId,
          userEmail: session.user.email ?? null,
          userName: session.user.name ?? null,
        }).catch(() => {});

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      } catch (err) {
        const message = err instanceof Error ? err.message : "AI request failed";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`),
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
