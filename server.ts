/**
 * WebSocket wrapper for Next.js standalone server.
 *
 * In production (Docker), the Dockerfile renames the default standalone server.js
 * to next-server.js, then bundles this file as server.js. It intercepts the HTTP
 * server that Next.js creates and layers WebSocket upgrade handling on top.
 *
 * In dev mode (`pnpm dev`), this uses the standard `next()` custom server API.
 */
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

// Lazy-loaded auth and registry (bundled by esbuild in production)
let _authenticateWsUpgrade: typeof import("./src/server/services/ws-auth").authenticateWsUpgrade;
let _wsRegistry: typeof import("./src/server/services/ws-registry").wsRegistry;

async function getWsDeps() {
  if (!_authenticateWsUpgrade) {
    const auth = await import("./src/server/services/ws-auth");
    const reg = await import("./src/server/services/ws-registry");
    _authenticateWsUpgrade = auth.authenticateWsUpgrade;
    _wsRegistry = reg.wsRegistry;
  }
  return { authenticateWsUpgrade: _authenticateWsUpgrade, wsRegistry: _wsRegistry };
}

function setupWebSocket(server: ReturnType<typeof createServer>) {
  const wss = new WebSocketServer({ noServer: true });

  // Use prependListener so our handler runs before Next.js's upgrade handler.
  // We only handle /api/agent/ws; all other upgrade requests fall through to Next.js.
  server.prependListener("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const { pathname } = parse(req.url ?? "/", true);
    if (pathname !== WS_PATH) return;

    // Remove other upgrade listeners for this request to prevent Next.js
    // from also trying to handle the already-consumed socket.
    socket.removeAllListeners("close");

    const { authenticateWsUpgrade, wsRegistry } = await getWsDeps();
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
    _wsRegistry.register(nodeId, ws);

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
      _wsRegistry.unregister(nodeId, ws);
    });

    ws.on("error", (err: Error) => {
      console.error(`[ws] error for agent ${nodeId}:`, err.message);
      clearInterval(pingInterval);
      if (pongTimer) clearTimeout(pongTimer);
      _wsRegistry.unregister(nodeId, ws);
    });
  });
}

if (dev) {
  // ── Dev mode: standard Next.js custom server ──
  import("next").then(({ default: next }) => {
    const app = next({ dev, hostname, port });
    const handle = app.getRequestHandler();

    app.prepare().then(() => {
      const server = createServer((req, res) => {
        const parsedUrl = parse(req.url ?? "/", true);
        handle(req, res, parsedUrl);
      });

      setupWebSocket(server);

      server.listen(port, hostname, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
      });
    });
  });
} else {
  // ── Production: wrap the standalone Next.js server ──
  // Monkey-patch http.createServer to intercept the server instance that
  // Next.js's standalone server.js (renamed to next-server.js) creates.
  const http = require("http") as typeof import("http");
  const origCreateServer = http.createServer.bind(http);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (http as any).createServer = function (...args: any[]) {
    const server = origCreateServer(...args);
    setupWebSocket(server);
    return server;
  };

  // Load the original standalone server (with inlined config, static file
  // serving, and all Next.js initialization). It calls http.createServer
  // internally, which our patch intercepts.
  require("./next-server.js");
}
