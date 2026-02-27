export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(async () => {
        try {
          // Import prisma and query current node statuses
          const { prisma } = await import("@/lib/prisma");
          const nodes = await prisma.vectorNode.findMany({
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
      }, 5000); // Update every 5 seconds

      // Cleanup on close
      const cleanup = () => clearInterval(interval);
      // Note: controller.close() will be called when the connection drops
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
