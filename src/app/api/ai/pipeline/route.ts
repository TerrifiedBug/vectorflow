export const runtime = "nodejs";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { streamCompletion } from "@/server/services/ai";
import { buildPipelineSystemPrompt } from "@/lib/ai/prompts";

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
  if (membership && membership.role === "VIEWER") {
    return new Response(JSON.stringify({ error: "EDITOR role required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const mode = body.mode;

  const systemPrompt = buildPipelineSystemPrompt({
    mode,
    currentYaml: body.currentYaml,
    environmentName: body.environmentName,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await streamCompletion({
          teamId: body.teamId,
          systemPrompt,
          userPrompt: body.prompt,
          onToken: (token) => {
            const data = JSON.stringify({ token });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          },
          signal: request.signal,
        });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
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
