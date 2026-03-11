import { createServer, type IncomingMessage } from "http";
import type { Socket } from "net";
import { parse } from "url";
import { type WebSocket, WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const WS_PATH = "/api/agent/ws";

async function getRequestHandler() {
  if (dev) {
    // Dev mode: use the full next() factory which handles HMR, config reloading, etc.
    const next = (await import("next")).default;
    const app = next({ dev, hostname, port });
    await app.prepare();
    return app.getRequestHandler();
  }

  // Production/standalone: use NextServer directly with pre-baked config
  // to avoid loading next.config.ts (which requires webpack, stripped from standalone)
  const path = await import("path");
  const fs = await import("fs");
  const dir = path.join(__dirname);
  process.chdir(dir);

  const requiredServerFiles = JSON.parse(
    fs.readFileSync(path.join(dir, ".next", "required-server-files.json"), "utf8"),
  );

  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredServerFiles.config);

  const NextServer = (await import("next/dist/server/next-server")).default;
  const app = new NextServer({
    hostname,
    port,
    dir,
    dev: false,
    customServer: true,
    conf: requiredServerFiles.config,
  });
  await app.prepare();
  return app.getRequestHandler();
}

getRequestHandler().then(async (handle) => {
  const { authenticateWsUpgrade } = await import("./src/server/services/ws-auth");
  const { wsRegistry } = await import("./src/server/services/ws-registry");

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const { pathname } = parse(req.url ?? "/", true);

    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    const agent = await authenticateWsUpgrade(req);
    if (!agent) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, agent);
    });
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, agent: { nodeId: string; environmentId: string }) => {
    const { nodeId } = agent;
    console.log(`[ws] agent connected: ${nodeId}`);
    wsRegistry.register(nodeId, ws);

    let alive = true;
    let pongTimer: ReturnType<typeof setTimeout> | null = null;

    ws.on("pong", () => {
      alive = true;
      if (pongTimer) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
    });

    const pingInterval = setInterval(() => {
      if (!alive) {
        console.log(`[ws] agent ${nodeId} did not respond to ping, terminating`);
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
      pongTimer = setTimeout(() => {
        if (!alive) {
          console.log(`[ws] agent ${nodeId} pong timeout (${PONG_TIMEOUT_MS}ms), terminating`);
          ws.terminate();
        }
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);

    ws.on("close", () => {
      console.log(`[ws] agent disconnected: ${nodeId}`);
      clearInterval(pingInterval);
      if (pongTimer) clearTimeout(pongTimer);
      wsRegistry.unregister(nodeId, ws);
    });

    ws.on("error", (err: Error) => {
      console.error(`[ws] error for agent ${nodeId}:`, err.message);
      clearInterval(pingInterval);
      if (pongTimer) clearTimeout(pongTimer);
      wsRegistry.unregister(nodeId, ws);
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
