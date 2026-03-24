// src/server/services/sse-registry.ts
import type { SSEEvent } from "@/lib/sse/types";

interface SSEConnection {
  controller: ReadableStreamDefaultController;
  userId: string;
  environmentIds: string[];
}

const KEEPALIVE_INTERVAL_MS = 30_000;

export class SSERegistry {
  private connections = new Map<string, SSEConnection>();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startKeepalive();
  }

  /** Register a new browser SSE connection. Keyed by connectionId (UUID), not userId. */
  register(
    connectionId: string,
    controller: ReadableStreamDefaultController,
    userId: string,
    environmentIds: string[],
  ): void {
    this.connections.set(connectionId, { controller, userId, environmentIds });
  }

  /** Unregister a connection. Optional controller arg for stale-check (same pattern as PushRegistry). */
  unregister(
    connectionId: string,
    controller?: ReadableStreamDefaultController,
  ): void {
    if (controller) {
      const current = this.connections.get(connectionId);
      if (current?.controller !== controller) return; // stale — newer connection exists
    }
    this.connections.delete(connectionId);
  }

  /** Broadcast an event to all connections authorized for the given environmentId. */
  broadcast(event: SSEEvent, environmentId: string): void {
    const encoded = new TextEncoder().encode(
      `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    );
    for (const [connectionId, conn] of this.connections) {
      if (!conn.environmentIds.includes(environmentId)) continue;
      try {
        conn.controller.enqueue(encoded);
      } catch {
        // Dead connection — clean up
        this.connections.delete(connectionId);
      }
    }
  }

  /** Send an event to a specific connection. Returns false if connection not found or dead. */
  send(connectionId: string, event: SSEEvent): boolean {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;
    try {
      const encoded = new TextEncoder().encode(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
      conn.controller.enqueue(encoded);
      return true;
    } catch {
      this.connections.delete(connectionId);
      return false;
    }
  }

  /** Number of active connections. */
  get size(): number {
    return this.connections.size;
  }

  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      const keepalive = new TextEncoder().encode(": keepalive\n\n");
      for (const [connectionId, conn] of this.connections) {
        try {
          conn.controller.enqueue(keepalive);
        } catch {
          this.connections.delete(connectionId);
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
    // Allow Node.js to exit cleanly even if timer is active (tests, cold starts)
    this.keepaliveTimer.unref();
  }
}

export const sseRegistry = new SSERegistry();
