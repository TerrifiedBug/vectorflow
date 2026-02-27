import { prisma } from "@/lib/prisma";
import {
  queryHealth,
  queryComponents,
  type VectorComponentMetrics,
} from "@/server/integrations/vector-graphql";

export type { VectorComponentMetrics };

export interface NodeMetrics {
  nodeId: string;
  timestamp: Date;
  components: VectorComponentMetrics[];
}

class FleetPoller {
  private intervalId: NodeJS.Timeout | null = null;
  private metricsBuffer: Map<string, NodeMetrics[]> = new Map();
  private consecutiveFailures: Map<string, number> = new Map();
  private pollIntervalMs = 15000;
  private unhealthyThreshold = 3;

  async start() {
    // Load settings from DB
    const settings = await prisma.systemSettings.findFirst();
    if (settings) {
      this.pollIntervalMs = settings.fleetPollIntervalMs;
      this.unhealthyThreshold = settings.fleetUnhealthyThreshold;
    }

    this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs);
    this.poll(); // First poll immediately
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll() {
    const nodes = await prisma.vectorNode.findMany();

    await Promise.allSettled(nodes.map((node) => this.pollNode(node)));
  }

  private async pollNode(node: {
    id: string;
    host: string;
    apiPort: number;
  }) {
    const health = await queryHealth(node.host, node.apiPort);
    const failCount = this.consecutiveFailures.get(node.id) || 0;

    if (health.healthy) {
      this.consecutiveFailures.set(node.id, 0);

      // Also fetch component metrics
      const components = await queryComponents(node.host, node.apiPort);
      this.storeMetrics(node.id, components);

      await prisma.vectorNode.update({
        where: { id: node.id },
        data: { status: "HEALTHY", lastSeen: new Date() },
      });
    } else {
      const newFailCount = failCount + 1;
      this.consecutiveFailures.set(node.id, newFailCount);

      const status =
        newFailCount >= this.unhealthyThreshold ? "UNREACHABLE" : "DEGRADED";
      await prisma.vectorNode.update({
        where: { id: node.id },
        data: { status },
      });
    }
  }

  private storeMetrics(
    nodeId: string,
    components: VectorComponentMetrics[]
  ) {
    const existing = this.metricsBuffer.get(nodeId) || [];
    existing.push({ nodeId, timestamp: new Date(), components });

    // Keep 1 hour of metrics
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const filtered = existing.filter((m) => m.timestamp > oneHourAgo);
    this.metricsBuffer.set(nodeId, filtered);
  }

  getRecentMetrics(nodeId: string): NodeMetrics[] {
    return this.metricsBuffer.get(nodeId) || [];
  }
}

// Singleton
const globalForPoller = globalThis as unknown as {
  fleetPoller: FleetPoller | undefined;
};
export const fleetPoller =
  globalForPoller.fleetPoller ?? new FleetPoller();
if (process.env.NODE_ENV !== "production")
  globalForPoller.fleetPoller = fleetPoller;
