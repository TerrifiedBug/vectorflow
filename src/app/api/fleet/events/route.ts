import { auth } from "@/auth";
import { isOrgWideAdmin } from "@/lib/org-admin";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // Require authenticated session
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve the user's org for the isOrgWideAdmin check + env scope.
  // OSS is single-tenant — every user lives in DEFAULT_ORG_ID — so
  // taking the oldest OrgMember is unambiguous. In multi-org cloud
  // surfaces the org SHOULD come from the request tenant (host
  // header → organizationId); that resolver lives in vectorflow-cloud
  // and the cloud-side route overrides this path. codex PR #381 P1
  // flagged the multi-org case; see ADR-N for the cloud strategy.
  const userId = session.user.id;

  const primaryMembership = await prisma.orgMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  const userOrgId = primaryMembership?.organizationId ?? null;
  const isOrgAdmin = userOrgId ? await isOrgWideAdmin(userId, userOrgId) : false;

  let environmentFilter:
    | { id: { in: string[] } }
    | { organizationId: string }
    | undefined;
  if (isOrgAdmin && userOrgId) {
    environmentFilter = { organizationId: userOrgId };
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
    environmentFilter = { id: { in: environments.map((e) => e.id) } };
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(async () => {
        try {
          const nodes = await prisma.vectorNode.findMany({
            where: environmentFilter
              ? { environment: environmentFilter }
              : undefined,
            select: {
              id: true,
              status: true,
              lastSeen: true,
              name: true,
              host: true,
            },
          });

          const data = JSON.stringify({
            type: "node:status",
            timestamp: new Date().toISOString(),
            nodes: nodes.map((n) => ({
              id: n.id,
              status: n.status,
              lastSeen: n.lastSeen,
              name: n.name,
            })),
          });

          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Silently continue on errors
        }
      }, 5000);

      // Cleanup on close
      const cleanup = () => clearInterval(interval);
      void cleanup;
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
