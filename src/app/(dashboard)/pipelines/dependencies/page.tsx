"use client";

import { useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Dagre from "@dagrejs/dagre";
import { Network, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";

import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import {
  dependencyGraphNodeTypes,
  type DependencyGraphNodeData,
} from "@/components/pipeline/dependency-graph-node";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

// ── Dagre layout helper ─────────────────────────────────────────────────
const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

function applyDagreLayout(
  nodes: Node<DependencyGraphNodeData>[],
  edges: Edge[],
): Node<DependencyGraphNodeData>[] {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  Dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

// ── Graph content (inside ReactFlowProvider) ────────────────────────────
function DependencyGraphContent() {
  const router = useRouter();
  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );
  const environmentId = selectedEnvironmentId ?? "";

  const { data, isLoading } = useQuery(
    trpc.pipelineDependency.graph.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };

    const rawNodes: Node<DependencyGraphNodeData>[] = data.pipelines.map(
      (p) => ({
        id: p.id,
        type: "pipeline" as const,
        data: {
          name: p.name,
          isDraft: p.isDraft,
          nodeStatuses: p.nodeStatuses,
        },
        position: { x: 0, y: 0 },
      }),
    );

    const rawEdges: Edge[] = data.dependencies.map((d) => ({
      id: d.id,
      source: d.upstreamId,
      target: d.downstreamId,
      animated: true,
    }));

    const laidOut = applyDagreLayout(rawNodes, rawEdges);
    return { nodes: laidOut, edges: rawEdges };
  }, [data]);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      router.push(`/pipelines/${node.id}`);
    },
    [router],
  );

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasDependencies = edges.length > 0;

  if (!hasDependencies) {
    return (
      <EmptyState
        icon={Network}
        title="No dependency graph yet"
        description="This environment has pipelines, but no upstream/downstream gates are configured. Add a dependency from a pipeline’s settings, then return here to verify deploy order and blast radius."
        action={{ label: "Open pipelines", href: "/pipelines" }}
        secondary={{ label: "Create pipeline", href: "/pipelines/new" }}
        helperLines={[
          { icon: "1", text: "Open a pipeline that must wait for another pipeline." },
          { icon: "2", text: "Add its upstream requirement in dependency settings." },
          { icon: "3", text: "Refresh this graph to confirm the route before deploying." },
        ]}
        className="mt-8"
      />
    );
  }

  return (
    <div className="h-[calc(100vh-12rem)] w-full rounded-lg border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={dependencyGraphNodeTypes}
        onNodeClick={onNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

// ── Page wrapper ────────────────────────────────────────────────────────
export default function PipelineDependenciesPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Pipeline dependencies"
        subtitle="Deploy-order map for upstream requirements and downstream blast radius."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/pipelines">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Pipelines
            </Link>
          </Button>
        }
      />
      <div className="p-4">
        <ReactFlowProvider>
          <DependencyGraphContent />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
