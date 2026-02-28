"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NodeStatus } from "@/generated/prisma";

const statusColors: Record<NodeStatus, string> = {
  HEALTHY: "bg-green-500/15 text-green-700 dark:text-green-400",
  DEGRADED: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  UNREACHABLE: "bg-red-500/15 text-red-700 dark:text-red-400",
  UNKNOWN: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

function formatLastSeen(date: Date | string | null): string {
  if (!date) return "Never";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return d.toLocaleDateString();
}

export default function FleetPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");
  const [newNode, setNewNode] = useState({
    name: "",
    host: "",
    apiPort: "8686",
    environmentId: "",
  });

  const teamsQuery = useQuery(trpc.team.list.queryOptions());
  const firstTeamId = teamsQuery.data?.[0]?.id;

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: firstTeamId! },
      { enabled: !!firstTeamId }
    )
  );

  const environments = environmentsQuery.data ?? [];

  // Pick the first environment if none is selected yet
  const activeEnvId = selectedEnvId || environments[0]?.id || "";

  const nodesQuery = useQuery(
    trpc.fleet.list.queryOptions(
      { environmentId: activeEnvId },
      { enabled: !!activeEnvId }
    )
  );

  const createMutation = useMutation(
    trpc.fleet.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.fleet.list.queryKey() });
        setDialogOpen(false);
        setNewNode({ name: "", host: "", apiPort: "8686", environmentId: "" });
      },
    })
  );

  const isLoading =
    teamsQuery.isLoading ||
    environmentsQuery.isLoading ||
    nodesQuery.isLoading;

  const nodes = nodesQuery.data ?? [];

  function handleCreateNode(e: React.FormEvent) {
    e.preventDefault();
    const envId = newNode.environmentId || activeEnvId;
    if (!envId) return;
    createMutation.mutate({
      name: newNode.name,
      host: newNode.host,
      apiPort: parseInt(newNode.apiPort, 10),
      environmentId: envId,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Fleet</h2>
          <p className="text-muted-foreground">
            Manage your Vector node fleet
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Node
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Node</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateNode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="node-name">Name</Label>
                <Input
                  id="node-name"
                  placeholder="e.g., vector-prod-01"
                  value={newNode.name}
                  onChange={(e) =>
                    setNewNode((prev) => ({ ...prev, name: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="node-host">Host</Label>
                <Input
                  id="node-host"
                  placeholder="e.g., 10.0.1.50"
                  value={newNode.host}
                  onChange={(e) =>
                    setNewNode((prev) => ({ ...prev, host: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="node-port">API Port</Label>
                <Input
                  id="node-port"
                  type="number"
                  placeholder="8686"
                  value={newNode.apiPort}
                  onChange={(e) =>
                    setNewNode((prev) => ({
                      ...prev,
                      apiPort: e.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="node-env">Environment</Label>
                <Select
                  value={newNode.environmentId || activeEnvId}
                  onValueChange={(value) =>
                    setNewNode((prev) => ({ ...prev, environmentId: value }))
                  }
                >
                  <SelectTrigger id="node-env">
                    <SelectValue placeholder="Select environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {environments.map((env) => (
                      <SelectItem key={env.id} value={env.id}>
                        {env.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Adding..." : "Add Node"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {environments.length > 1 && (
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Environment:</Label>
          <Select value={activeEnvId} onValueChange={setSelectedEnvId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select environment" />
            </SelectTrigger>
            <SelectContent>
              {environments.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  {env.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No nodes in your fleet yet</p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => setDialogOpen(true)}
          >
            Add your first node
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Host:Port</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => (
              <TableRow key={node.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/fleet/${node.id}`}
                    className="hover:underline"
                  >
                    {node.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {node.host}:{node.apiPort}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{node.environment.name}</Badge>
                </TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {((node.metadata as Record<string, unknown> | null)?.vectorVersion as string)?.split(" ")[0] ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={statusColors[node.status as NodeStatus]}
                  >
                    {node.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatLastSeen(node.lastSeen)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
