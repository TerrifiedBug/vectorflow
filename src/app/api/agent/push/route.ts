import { authenticateAgent } from "@/server/services/agent-auth";
import { pushRegistry } from "@/server/services/push-registry";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { nodeId, environmentId } = agent;
  let controllerRef: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      pushRegistry.register(nodeId, controller, environmentId);
      // Send initial comment to confirm connection
      controller.enqueue(new TextEncoder().encode(": connected\n\n"));
    },
    cancel() {
      if (controllerRef) {
        pushRegistry.unregister(nodeId, controllerRef);
      }
    },
  });

  // Also unregister on client abort
  request.signal.addEventListener("abort", () => {
    if (controllerRef) {
      pushRegistry.unregister(nodeId, controllerRef);
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
