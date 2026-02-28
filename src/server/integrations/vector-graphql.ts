export interface VectorComponentMetrics {
  componentId: string;
  componentType: string;
  kind: "source" | "transform" | "sink";
  receivedEventsTotal: number;
  sentEventsTotal: number;
  receivedBytesTotal?: number;
  sentBytesTotal?: number;
}

export interface VectorHealthResult {
  healthy: boolean;
  version?: string;
  uptime?: number;
}

export async function queryHealth(
  host: string,
  port: number
): Promise<VectorHealthResult> {
  const url = `http://${host}:${port}/graphql`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{ health meta { versionString } }`,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return {
      healthy: data.data?.health === true,
      version: data.data?.meta?.versionString ?? undefined,
    };
  } catch {
    return { healthy: false };
  }
}

export async function queryComponents(
  host: string,
  port: number
): Promise<VectorComponentMetrics[]> {
  const url = `http://${host}:${port}/graphql`;
  const query = `{
    components(first: 1000) {
      edges {
        node {
          __typename
          componentId
          componentType
          ... on Source {
            metrics { receivedEventsTotal { receivedEventsTotal } sentEventsTotal { sentEventsTotal } receivedBytesTotal { receivedBytesTotal } }
          }
          ... on Transform {
            metrics { receivedEventsTotal { receivedEventsTotal } sentEventsTotal { sentEventsTotal } }
          }
          ... on Sink {
            metrics { receivedEventsTotal { receivedEventsTotal } sentEventsTotal { sentEventsTotal } sentBytesTotal { sentBytesTotal } }
          }
        }
      }
    }
  }`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    // Parse and normalize the response
    return (data.data?.components?.edges || []).map((edge: any) => {
      const node = edge.node;
      const kind = node.__typename.toLowerCase() as
        | "source"
        | "transform"
        | "sink";
      return {
        componentId: node.componentId,
        componentType: node.componentType,
        kind,
        receivedEventsTotal:
          node.metrics?.receivedEventsTotal?.receivedEventsTotal || 0,
        sentEventsTotal:
          node.metrics?.sentEventsTotal?.sentEventsTotal || 0,
        receivedBytesTotal:
          node.metrics?.receivedBytesTotal?.receivedBytesTotal,
        sentBytesTotal: node.metrics?.sentBytesTotal?.sentBytesTotal,
      };
    });
  } catch {
    return [];
  }
}
