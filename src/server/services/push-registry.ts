// src/server/services/push-registry.ts
import type { PushMessage } from "./push-types";

interface Connection {
  controller: ReadableStreamDefaultController;
  environmentId: string;
}

const KEEPALIVE_INTERVAL_MS = 30_000;

class PushRegistry {
  private connections = new Map<string, Connection>();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startKeepalive();
  }

  register(
    nodeId: string,
    controller: ReadableStreamDefaultController,
    environmentId: string,
  ): void {
    const existing = this.connections.get(nodeId);
    if (existing) {
      try {
        existing.controller.close();
      } catch {
        // already closed
      }
    }
    this.connections.set(nodeId, { controller, environmentId });
  }

  unregister(nodeId: string, controller?: ReadableStreamDefaultController): void {
    if (controller) {
      const current = this.connections.get(nodeId);
      if (current?.controller !== controller) return; // stale — newer connection exists
    }
    this.connections.delete(nodeId);
  }

  send(nodeId: string, message: PushMessage): boolean {
    const conn = this.connections.get(nodeId);
    if (!conn) return false;
    try {
      const encoded = `event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`;
      conn.controller.enqueue(new TextEncoder().encode(encoded));
      return true;
    } catch {
      this.connections.delete(nodeId);
      return false;
    }
  }

  broadcast(nodeIds: string[], message: PushMessage): string[] {
    const sent: string[] = [];
    for (const nodeId of nodeIds) {
      if (this.send(nodeId, message)) {
        sent.push(nodeId);
      }
    }
    return sent;
  }

  isConnected(nodeId: string): boolean {
    return this.connections.has(nodeId);
  }

  get size(): number {
    return this.connections.size;
  }

  private startKeepalive(): void {
    // unref() allows Node.js to exit cleanly even if timer is active (tests, cold starts)
    this.keepaliveTimer = setInterval(() => {
      const encoder = new TextEncoder();
      const keepalive = encoder.encode(": keepalive\n\n");
      for (const [nodeId, conn] of this.connections) {
        try {
          conn.controller.enqueue(keepalive);
        } catch {
          this.connections.delete(nodeId);
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
    this.keepaliveTimer.unref();
  }
}

export const pushRegistry = new PushRegistry();
