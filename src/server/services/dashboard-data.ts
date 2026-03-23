import type { MetricSample } from "@/server/services/metric-store";
import { generateVectorYaml } from "@/lib/config-generator";
import { decryptNodeConfig } from "@/server/services/config-crypto";

// ─── Shared types ────────────────────────────────────────────────────────────

type TSMap = Record<string, { t: number; v: number }[]>;

// ─── Private helpers for chartMetrics ────────────────────────────────────────

function addPoint(map: TSMap, label: string, t: number, v: number) {
  if (!map[label]) map[label] = [];
  map[label].push({ t, v });
}

function downsample(map: TSMap, bucketMs: number): TSMap {
  if (bucketMs === 0) return map;
  const result: TSMap = {};
  for (const [label, points] of Object.entries(map)) {
    const buckets = new Map<number, { sum: number; count: number }>();
    for (const p of points) {
      const bucket = Math.floor(p.t / bucketMs) * bucketMs;
      const b = buckets.get(bucket) ?? { sum: 0, count: 0 };
      b.sum += p.v;
      b.count++;
      buckets.set(bucket, b);
    }
    result[label] = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, b]) => ({ t, v: b.sum / b.count }));
  }
  return result;
}

function avgSeries(map: TSMap): TSMap {
  const acc = new Map<number, { sum: number; count: number }>();
  for (const points of Object.values(map)) {
    for (const p of points) {
      const s = acc.get(p.t) ?? { sum: 0, count: 0 };
      s.sum += p.v;
      s.count++;
      acc.set(p.t, s);
    }
  }
  const sorted = Array.from(acc.entries()).sort((a, b) => a[0] - b[0]);
  return { Total: sorted.map(([t, s]) => ({ t, v: s.sum / s.count })) };
}

function sumSeries(map: TSMap): TSMap {
  const acc = new Map<number, number>();
  for (const points of Object.values(map)) {
    for (const p of points) {
      acc.set(p.t, (acc.get(p.t) ?? 0) + p.v);
    }
  }
  const sorted = Array.from(acc.entries()).sort((a, b) => a[0] - b[0]);
  return { Total: sorted.map(([t, v]) => ({ t, v })) };
}

// ─── computeChartMetrics ─────────────────────────────────────────────────────

interface ChartMetricsInput {
  range: string;
  groupBy: "pipeline" | "node" | "aggregate";
  nodeNameMap: Map<string, string>;
  pipelineNameMap: Map<string, string>;
  pipelineRows: {
    pipelineId: string;
    nodeId: string | null;
    timestamp: Date;
    eventsIn: bigint;
    eventsOut: bigint;
    bytesIn: bigint;
    bytesOut: bigint;
    errorsTotal: bigint;
    eventsDiscarded: bigint;
    latencyMeanMs: number | null;
  }[];
  nodeRows: {
    nodeId: string;
    timestamp: Date;
    cpuSecondsTotal: number;
    cpuSecondsIdle: number;
    memoryUsedBytes: bigint;
    memoryTotalBytes: bigint;
    diskReadBytes: bigint;
    diskWrittenBytes: bigint;
    netRxBytes: bigint;
    netTxBytes: bigint;
  }[];
  filterOptions: {
    nodes: { id: string; name: string }[];
    pipelines: { id: string; name: string }[];
  };
}

export function computeChartMetrics(input: ChartMetricsInput) {
  const {
    range,
    groupBy,
    nodeNameMap,
    pipelineNameMap,
    pipelineRows,
    nodeRows,
    filterOptions,
  } = input;

  const bucketMs = range === "7d" ? 5 * 60 * 1000 : 0;

  const eventsIn: TSMap = {};
  const eventsOut: TSMap = {};
  const bytesIn: TSMap = {};
  const bytesOut: TSMap = {};
  const errors: TSMap = {};
  const discarded: TSMap = {};
  const latency: TSMap = {};

  if (groupBy === "node") {
    // Sum pipeline values per (node, timestamp) since multiple pipelines on one node produce multiple rows
    const acc = new Map<
      string,
      Map<number, { ei: number; eo: number; bi: number; bo: number; er: number; di: number; lat: number; latC: number }>
    >();
    for (const row of pipelineRows) {
      const label = nodeNameMap.get(row.nodeId ?? "") ?? row.nodeId ?? "unknown";
      const t = new Date(row.timestamp).getTime();
      if (!acc.has(label)) acc.set(label, new Map());
      const timeMap = acc.get(label)!;
      const s = timeMap.get(t) ?? { ei: 0, eo: 0, bi: 0, bo: 0, er: 0, di: 0, lat: 0, latC: 0 };
      s.ei += Number(row.eventsIn) / 60;
      s.eo += Number(row.eventsOut) / 60;
      s.bi += Number(row.bytesIn) / 60;
      s.bo += Number(row.bytesOut) / 60;
      s.er += Number(row.errorsTotal) / 60;
      s.di += Number(row.eventsDiscarded) / 60;
      if (row.latencyMeanMs != null) {
        s.lat += row.latencyMeanMs;
        s.latC++;
      }
      timeMap.set(t, s);
    }
    for (const [label, timeMap] of acc) {
      for (const [t, s] of timeMap) {
        addPoint(eventsIn, label, t, s.ei);
        addPoint(eventsOut, label, t, s.eo);
        addPoint(bytesIn, label, t, s.bi);
        addPoint(bytesOut, label, t, s.bo);
        addPoint(errors, label, t, s.er);
        addPoint(discarded, label, t, s.di);
        if (s.latC > 0) addPoint(latency, label, t, s.lat / s.latC);
      }
    }
  } else if (groupBy === "aggregate") {
    // Sum all pipelines into a single "Total" series per timestamp
    const acc = new Map<
      number,
      { ei: number; eo: number; bi: number; bo: number; er: number; di: number; lat: number; latC: number }
    >();
    for (const row of pipelineRows) {
      const t = new Date(row.timestamp).getTime();
      const s = acc.get(t) ?? { ei: 0, eo: 0, bi: 0, bo: 0, er: 0, di: 0, lat: 0, latC: 0 };
      s.ei += Number(row.eventsIn) / 60;
      s.eo += Number(row.eventsOut) / 60;
      s.bi += Number(row.bytesIn) / 60;
      s.bo += Number(row.bytesOut) / 60;
      s.er += Number(row.errorsTotal) / 60;
      s.di += Number(row.eventsDiscarded) / 60;
      if (row.latencyMeanMs != null) {
        s.lat += row.latencyMeanMs;
        s.latC++;
      }
      acc.set(t, s);
    }
    for (const [t, s] of acc) {
      addPoint(eventsIn, "Total", t, s.ei);
      addPoint(eventsOut, "Total", t, s.eo);
      addPoint(bytesIn, "Total", t, s.bi);
      addPoint(bytesOut, "Total", t, s.bo);
      addPoint(errors, "Total", t, s.er);
      addPoint(discarded, "Total", t, s.di);
      if (s.latC > 0) addPoint(latency, "Total", t, s.lat / s.latC);
    }
  } else {
    // groupBy === "pipeline" — direct mapping, one series per pipeline
    for (const row of pipelineRows) {
      const label = pipelineNameMap.get(row.pipelineId) ?? row.pipelineId;
      const t = new Date(row.timestamp).getTime();
      addPoint(eventsIn, label, t, Number(row.eventsIn) / 60);
      addPoint(eventsOut, label, t, Number(row.eventsOut) / 60);
      addPoint(bytesIn, label, t, Number(row.bytesIn) / 60);
      addPoint(bytesOut, label, t, Number(row.bytesOut) / 60);
      addPoint(errors, label, t, Number(row.errorsTotal) / 60);
      addPoint(discarded, label, t, Number(row.eventsDiscarded) / 60);
      if (row.latencyMeanMs != null) {
        addPoint(latency, label, t, row.latencyMeanMs);
      }
    }
  }

  const cpu: TSMap = {};
  const memory: TSMap = {};
  const diskRead: TSMap = {};
  const diskWrite: TSMap = {};
  const netRx: TSMap = {};
  const netTx: TSMap = {};

  const nodeRowsByNode = new Map<string, typeof nodeRows>();
  for (const row of nodeRows) {
    const arr = nodeRowsByNode.get(row.nodeId) ?? [];
    arr.push(row);
    nodeRowsByNode.set(row.nodeId, arr);
  }

  for (const [nodeId, rows] of nodeRowsByNode) {
    const label = nodeNameMap.get(nodeId) ?? nodeId;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      const t = new Date(curr.timestamp).getTime();
      const dtSec = (t - new Date(prev.timestamp).getTime()) / 1000;
      if (dtSec <= 0) continue;

      const cpuTotalDelta = curr.cpuSecondsTotal - prev.cpuSecondsTotal;
      const cpuIdleDelta = curr.cpuSecondsIdle - prev.cpuSecondsIdle;
      const cpuPct =
        cpuTotalDelta > 0
          ? Math.max(0, Math.min(100, ((cpuTotalDelta - cpuIdleDelta) / cpuTotalDelta) * 100))
          : 0;
      addPoint(cpu, label, t, cpuPct);

      const memTotal = Number(curr.memoryTotalBytes);
      const memUsed = Number(curr.memoryUsedBytes);
      addPoint(memory, label, t, memTotal > 0 ? (memUsed / memTotal) * 100 : 0);

      const dr = (Number(curr.diskReadBytes) - Number(prev.diskReadBytes)) / dtSec;
      const dw = (Number(curr.diskWrittenBytes) - Number(prev.diskWrittenBytes)) / dtSec;
      addPoint(diskRead, label, t, Math.max(0, dr));
      addPoint(diskWrite, label, t, Math.max(0, dw));

      const rx = (Number(curr.netRxBytes) - Number(prev.netRxBytes)) / dtSec;
      const tx = (Number(curr.netTxBytes) - Number(prev.netTxBytes)) / dtSec;
      addPoint(netRx, label, t, Math.max(0, rx));
      addPoint(netTx, label, t, Math.max(0, tx));
    }
  }

  // For aggregate grouping, collapse system metrics into single "Total" series
  if (groupBy === "aggregate") {
    const cpuAgg = avgSeries(cpu);
    const memAgg = avgSeries(memory);
    const drAgg = sumSeries(diskRead);
    const dwAgg = sumSeries(diskWrite);
    const rxAgg = sumSeries(netRx);
    const txAgg = sumSeries(netTx);

    // Clear and replace
    for (const key of Object.keys(cpu)) delete cpu[key];
    Object.assign(cpu, cpuAgg);
    for (const key of Object.keys(memory)) delete memory[key];
    Object.assign(memory, memAgg);
    for (const key of Object.keys(diskRead)) delete diskRead[key];
    Object.assign(diskRead, drAgg);
    for (const key of Object.keys(diskWrite)) delete diskWrite[key];
    Object.assign(diskWrite, dwAgg);
    for (const key of Object.keys(netRx)) delete netRx[key];
    Object.assign(netRx, rxAgg);
    for (const key of Object.keys(netTx)) delete netTx[key];
    Object.assign(netTx, txAgg);
  }

  return {
    pipeline: {
      eventsIn: downsample(eventsIn, bucketMs),
      eventsOut: downsample(eventsOut, bucketMs),
      bytesIn: downsample(bytesIn, bucketMs),
      bytesOut: downsample(bytesOut, bucketMs),
      errors: downsample(errors, bucketMs),
      discarded: downsample(discarded, bucketMs),
      latency: downsample(latency, bucketMs),
    },
    system: {
      cpu: downsample(cpu, bucketMs),
      memory: downsample(memory, bucketMs),
      diskRead: downsample(diskRead, bucketMs),
      diskWrite: downsample(diskWrite, bucketMs),
      netRx: downsample(netRx, bucketMs),
      netTx: downsample(netTx, bucketMs),
    },
    filterOptions,
  };
}

// ─── assembleNodeCards ───────────────────────────────────────────────────────

interface NodeCardNode {
  id: string;
  name: string;
  host: string | null;
  status: string;
  lastSeen: Date | null;
  environment: { id: string; name: string };
  pipelineStatuses: {
    status: string;
    eventsIn: bigint | null;
    eventsOut: bigint | null;
    bytesIn: bigint | null;
    bytesOut: bigint | null;
    errorsTotal: bigint | null;
    pipeline: { id: string; name: string };
  }[];
}

interface NodeMetricRow {
  nodeId: string;
  timestamp: Date;
  memoryUsedBytes: bigint;
  memoryTotalBytes: bigint;
  cpuSecondsTotal: number;
  cpuSecondsIdle: number;
}

export function assembleNodeCards(
  nodes: NodeCardNode[],
  metricsRows: NodeMetricRow[],
  latestSamples: Map<string, MetricSample>,
  componentKindMap: Map<string, string>,
) {
  // Group metrics by node
  const metricsByNode = new Map<string, NodeMetricRow[]>();
  for (const m of metricsRows) {
    const arr = metricsByNode.get(m.nodeId) ?? [];
    arr.push(m);
    metricsByNode.set(m.nodeId, arr);
  }

  // Resolve kind for a MetricStore key like "nodeId:pipelineId:my_source"
  function resolveKind(metricKey: string): string | undefined {
    const componentId = metricKey.split(":").slice(1).join(":");
    for (const [compKey, kind] of componentKindMap) {
      if (componentId.includes(compKey)) return kind;
    }
    return undefined;
  }

  return nodes.map((node) => {
    let pipelineCount = 0;
    let unhealthyPipelines = 0;
    let totalEventsIn = 0,
      totalEventsOut = 0;
    let totalBytesIn = 0,
      totalBytesOut = 0;
    let totalErrors = 0;
    let eventsInRate = 0,
      eventsOutRate = 0;
    let bytesInRate = 0,
      bytesOutRate = 0;
    let errorsRate = 0;

    for (const ps of node.pipelineStatuses) {
      pipelineCount++;
      totalEventsIn += Number(ps.eventsIn ?? 0);
      totalEventsOut += Number(ps.eventsOut ?? 0);
      totalBytesIn += Number(ps.bytesIn ?? 0);
      totalBytesOut += Number(ps.bytesOut ?? 0);
      totalErrors += Number(ps.errorsTotal ?? 0);
      if (ps.status !== "RUNNING") unhealthyPipelines++;
    }

    // Sum component-level rates for this node, scoped by kind
    for (const [key, sample] of latestSamples) {
      if (!key.startsWith(`${node.id}:`)) continue;
      const kind = resolveKind(key);
      if (kind === "SOURCE") {
        eventsInRate += sample.receivedEventsRate;
        bytesInRate += sample.receivedBytesRate;
      } else if (kind === "SINK") {
        eventsOutRate += sample.sentEventsRate;
        bytesOutRate += sample.sentBytesRate;
      }
      errorsRate += sample.errorsRate;
    }

    return {
      id: node.id,
      name: node.name,
      host: node.host,
      status: node.status,
      lastSeen: node.lastSeen,
      environment: node.environment,
      pipelineCount,
      unhealthyPipelines,
      rates: {
        eventsIn: eventsInRate,
        eventsOut: eventsOutRate,
        bytesIn: bytesInRate,
        bytesOut: bytesOutRate,
        errors: errorsRate,
      },
      totals: {
        eventsIn: totalEventsIn,
        eventsOut: totalEventsOut,
        bytesIn: totalBytesIn,
        bytesOut: totalBytesOut,
        errors: totalErrors,
      },
      sparkline: (metricsByNode.get(node.id) ?? []).map((m, i, arr) => {
        let cpu = 0;
        if (i > 0) {
          const prev = arr[i - 1];
          const totalDelta = m.cpuSecondsTotal - prev.cpuSecondsTotal;
          const idleDelta = m.cpuSecondsIdle - prev.cpuSecondsIdle;
          if (totalDelta > 0) {
            cpu = Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
          }
        }
        return {
          t: m.timestamp.getTime(),
          mem: m.memoryTotalBytes
            ? (Number(m.memoryUsedBytes) / Number(m.memoryTotalBytes)) * 100
            : 0,
          cpu,
        };
      }),
    };
  });
}

// ─── assemblePipelineCards ───────────────────────────────────────────────────

interface PipelineCardPipeline {
  id: string;
  name: string;
  deployedAt: Date | null;
  globalConfig: unknown;
  environment: { id: string; name: string };
  nodes: {
    id: string;
    componentType: string;
    componentKey: string;
    kind: string;
    config: unknown;
    positionX: number;
    positionY: number;
    disabled: boolean;
  }[];
  edges: {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourcePort: string | null;
  }[];
  nodeStatuses: {
    status: string;
    eventsIn: bigint | null;
    eventsOut: bigint | null;
    bytesIn: bigint | null;
    bytesOut: bigint | null;
    errorsTotal: bigint | null;
    node: { id: string; name: string; status: string };
  }[];
  versions: { version: number; configYaml: string | null; logLevel: string | null }[];
}

interface PipelineMetricRow {
  pipelineId: string;
  timestamp: Date;
  eventsIn: bigint | null;
  eventsOut: bigint | null;
  bytesIn: bigint | null;
  bytesOut: bigint | null;
}

interface PipelineComponentInfo {
  pipelineId: string;
  componentKey: string;
  kind: string;
}

export function assemblePipelineCards(
  pipelines: PipelineCardPipeline[],
  metricsRows: PipelineMetricRow[],
  latestSamples: Map<string, MetricSample>,
  pipelineComponentNodes: PipelineComponentInfo[],
) {
  const metricsByPipeline = new Map<string, PipelineMetricRow[]>();
  for (const m of metricsRows) {
    const arr = metricsByPipeline.get(m.pipelineId) ?? [];
    arr.push(m);
    metricsByPipeline.set(m.pipelineId, arr);
  }

  // Map componentKey → { pipelineId, kind }
  const componentToPipeline = new Map<string, { pipelineId: string; kind: string }>();
  for (const pn of pipelineComponentNodes) {
    componentToPipeline.set(pn.componentKey, { pipelineId: pn.pipelineId, kind: pn.kind });
  }

  // Aggregate rates per pipeline, scoped by kind
  const pipelineRates = new Map<
    string,
    { eventsIn: number; eventsOut: number; bytesIn: number; bytesOut: number; errors: number }
  >();
  for (const [key, sample] of latestSamples) {
    const componentId = key.split(":").slice(1).join(":");
    for (const [compKey, info] of componentToPipeline) {
      if (componentId.includes(compKey)) {
        const existing = pipelineRates.get(info.pipelineId) ?? {
          eventsIn: 0,
          eventsOut: 0,
          bytesIn: 0,
          bytesOut: 0,
          errors: 0,
        };
        if (info.kind === "SOURCE") {
          existing.eventsIn += sample.receivedEventsRate;
          existing.bytesIn += sample.receivedBytesRate;
        } else if (info.kind === "SINK") {
          existing.eventsOut += sample.sentEventsRate;
          existing.bytesOut += sample.sentBytesRate;
        }
        existing.errors += sample.errorsRate;
        pipelineRates.set(info.pipelineId, existing);
        break;
      }
    }
  }

  return pipelines.map((p) => {
    const rates = pipelineRates.get(p.id) ?? {
      eventsIn: 0,
      eventsOut: 0,
      bytesIn: 0,
      bytesOut: 0,
      errors: 0,
    };
    const totalEventsIn = p.nodeStatuses.reduce((s, ns) => s + Number(ns.eventsIn ?? 0), 0);
    const totalEventsOut = p.nodeStatuses.reduce((s, ns) => s + Number(ns.eventsOut ?? 0), 0);
    const totalBytesIn = p.nodeStatuses.reduce((s, ns) => s + Number(ns.bytesIn ?? 0), 0);
    const totalBytesOut = p.nodeStatuses.reduce((s, ns) => s + Number(ns.bytesOut ?? 0), 0);
    const totalErrors = p.nodeStatuses.reduce((s, ns) => s + Number(ns.errorsTotal ?? 0), 0);

    // Detect saved-but-undeployed changes by comparing current YAML to latest version
    let hasUndeployedChanges = false;
    const latestVersion = p.versions[0];
    if (latestVersion?.configYaml) {
      try {
        const decryptedNodes = p.nodes.map((n) => ({
          ...n,
          config: decryptNodeConfig(
            n.componentType,
            (n.config as Record<string, unknown>) ?? {},
          ),
        }));
        const flowNodes = decryptedNodes.map((n) => ({
          id: n.id,
          type: n.kind.toLowerCase(),
          position: { x: n.positionX, y: n.positionY },
          data: {
            componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
            componentKey: n.componentKey,
            config: n.config as Record<string, unknown>,
            disabled: n.disabled,
          },
        }));
        const flowEdges = p.edges.map((e) => ({
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
        }));
        const currentYaml = generateVectorYaml(
          flowNodes as Parameters<typeof generateVectorYaml>[0],
          flowEdges as Parameters<typeof generateVectorYaml>[1],
          p.globalConfig as Record<string, unknown> | null,
        );
        hasUndeployedChanges = currentYaml !== latestVersion.configYaml;

        // Also check log level changes (matches pipeline.ts logic)
        if (!hasUndeployedChanges) {
          const currentLogLevel =
            (p.globalConfig as Record<string, unknown>)?.log_level ?? null;
          const deployedLogLevel =
            (latestVersion as { logLevel?: string | null }).logLevel ?? null;
          if (currentLogLevel !== deployedLogLevel) {
            hasUndeployedChanges = true;
          }
        }
      } catch {
        hasUndeployedChanges = false;
      }
    } else if (latestVersion && !latestVersion.configYaml) {
      // Version exists but no configYaml — treat as changed
      hasUndeployedChanges = true;
    }

    return {
      id: p.id,
      name: p.name,
      environment: p.environment,
      deployedAt: p.deployedAt,
      latestVersion: p.versions[0]?.version ?? 0,
      hasUndeployedChanges,
      nodes: p.nodeStatuses.map((ns) => ({
        id: ns.node.id,
        name: ns.node.name,
        status: ns.node.status,
        pipelineStatus: ns.status,
      })),
      rates,
      totals: {
        eventsIn: totalEventsIn,
        eventsOut: totalEventsOut,
        bytesIn: totalBytesIn,
        bytesOut: totalBytesOut,
        errors: totalErrors,
      },
      sparkline: (metricsByPipeline.get(p.id) ?? []).map((m) => ({
        t: m.timestamp.getTime(),
        eventsIn: Number(m.eventsIn ?? 0) / 60,
        eventsOut: Number(m.eventsOut ?? 0) / 60,
      })),
    };
  });
}
