import type WebSocket from "ws";
import type { PushMessage } from "./ws-types";

class WsRegistry {
  private connections = new Map<string, WebSocket>();

  register(nodeId: string, ws: WebSocket): void {
    const existing = this.connections.get(nodeId);
    if (existing && existing.readyState === existing.OPEN) {
      existing.close(1000, "replaced");
    }
    this.connections.set(nodeId, ws);
  }

  /** Remove a connection. If `ws` is provided, only remove if it matches the
   *  current registered socket — prevents a stale close handler from removing
   *  a newer reconnection. */
  unregister(nodeId: string, ws?: WebSocket): void {
    if (ws) {
      const current = this.connections.get(nodeId);
      if (current !== ws) return; // stale socket — newer connection already registered
    }
    this.connections.delete(nodeId);
  }

  send(nodeId: string, message: PushMessage): boolean {
    const ws = this.connections.get(nodeId);
    if (!ws || ws.readyState !== ws.OPEN) {
      return false;
    }
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
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
    const ws = this.connections.get(nodeId);
    return ws !== undefined && ws.readyState === ws.OPEN;
  }

  get size(): number {
    let count = 0;
    for (const [, ws] of this.connections) {
      if (ws.readyState === ws.OPEN) count++;
    }
    return count;
  }
}

export const wsRegistry = new WsRegistry();
