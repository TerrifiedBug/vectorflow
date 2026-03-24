import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sseRegistry } from "@/server/services/sse-registry";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = session.user.id;

  // Resolve which environments this user can see
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperAdmin: true },
  });

  let environmentIds: string[];
  if (user?.isSuperAdmin) {
    const environments = await prisma.environment.findMany({
      select: { id: true },
    });
    environmentIds = environments.map((e) => e.id);
  } else {
    const memberships = await prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const teamIds = memberships.map((m) => m.teamId);
    const environments = await prisma.environment.findMany({
      where: { teamId: { in: teamIds } },
      select: { id: true },
    });
    environmentIds = environments.map((e) => e.id);
  }

  const connectionId = crypto.randomUUID();
  let controllerRef: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      sseRegistry.register(connectionId, controller, userId, environmentIds);
      controller.enqueue(new TextEncoder().encode(": connected\n\n"));
    },
    cancel() {
      if (controllerRef) {
        sseRegistry.unregister(connectionId, controllerRef);
      }
    },
  });

  // Also unregister on client abort
  request.signal.addEventListener("abort", () => {
    if (controllerRef) {
      sseRegistry.unregister(connectionId, controllerRef);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
