import { auth } from "@/auth";
import { isOrgWideAdmin } from "@/lib/org-admin";
import { prisma } from "@/lib/prisma";
import { sseRegistry } from "@/server/services/sse-registry";

export const dynamic = "force-dynamic";

const MAX_SSE_CONNECTIONS = parseInt(
  process.env.SSE_MAX_CONNECTIONS ?? "5000",
  10,
);

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = session.user.id;

  // Resolve user's primary org, then check admin status within that org
  const primaryMembership = await prisma.orgMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  const userOrgId = primaryMembership?.organizationId ?? null;
  const isOrgAdmin = userOrgId
    ? await isOrgWideAdmin(userId, userOrgId)
    : false;

  let environmentIds: string[];
  if (isOrgAdmin) {
    const environments = await prisma.environment.findMany({
      where: { organizationId: userOrgId ?? undefined },
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

  // PERF-03: Enforce per-instance SSE connection limit
  if (sseRegistry.size >= MAX_SSE_CONNECTIONS) {
    return new Response(
      JSON.stringify({ error: "SSE connection limit reached" }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "30",
        },
      },
    );
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
