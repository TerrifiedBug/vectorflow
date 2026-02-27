"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
  return d.toLocaleString();
}

export default function NodeDetailPage() {
  const params = useParams<{ nodeId: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [editName, setEditName] = useState("");
  const [editHost, setEditHost] = useState("");
  const [editPort, setEditPort] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const nodeQuery = useQuery(
    trpc.fleet.get.queryOptions({ id: params.nodeId })
  );

  const node = nodeQuery.data;

  useEffect(() => {
    if (node) {
      setEditName(node.name);
      setEditHost(node.host);
      setEditPort(String(node.apiPort));
    }
  }, [node]);

  useEffect(() => {
    if (node) {
      const changed =
        editName !== node.name ||
        editHost !== node.host ||
        editPort !== String(node.apiPort);
      setIsDirty(changed);
    }
  }, [editName, editHost, editPort, node]);

  const updateMutation = useMutation(
    trpc.fleet.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.fleet.get.queryKey({ id: params.nodeId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.fleet.list.queryKey(),
        });
        setIsDirty(false);
      },
    })
  );

  const deleteMutation = useMutation(
    trpc.fleet.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.fleet.list.queryKey(),
        });
        router.push("/fleet");
      },
    })
  );

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!node) return;
    updateMutation.mutate({
      id: node.id,
      name: editName,
      host: editHost,
      apiPort: parseInt(editPort, 10),
    });
  }

  function handleDelete() {
    if (!node) return;
    if (!confirm(`Delete node "${node.name}"? This action cannot be undone.`)) {
      return;
    }
    deleteMutation.mutate({ id: node.id });
  }

  if (nodeQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (nodeQuery.isError || !node) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push("/fleet")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Fleet
        </Button>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">Node not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/fleet")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{node.name}</h2>
            <p className="text-muted-foreground">
              {node.host}:{node.apiPort}
            </p>
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {deleteMutation.isPending ? "Deleting..." : "Delete Node"}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Node Details */}
        <Card>
          <CardHeader>
            <CardTitle>Node Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge
                  variant="outline"
                  className={statusColors[node.status as NodeStatus]}
                >
                  {node.status}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Environment</p>
                <p className="text-sm font-medium">{node.environment.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Host</p>
                <p className="text-sm font-mono">{node.host}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">API Port</p>
                <p className="text-sm font-mono">{node.apiPort}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Seen</p>
                <p className="text-sm">{formatLastSeen(node.lastSeen)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Created</p>
                <p className="text-sm">
                  {new Date(node.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Edit Form */}
        <Card>
          <CardHeader>
            <CardTitle>Edit Node</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-host">Host</Label>
                <Input
                  id="edit-host"
                  value={editHost}
                  onChange={(e) => setEditHost(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-port">API Port</Label>
                <Input
                  id="edit-port"
                  type="number"
                  value={editPort}
                  onChange={(e) => setEditPort(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={!isDirty || updateMutation.isPending}
                className="w-full"
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Live Metrics Placeholder */}
      <Card>
        <CardHeader>
          <CardTitle>Live Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
            <p className="text-muted-foreground">
              Live metrics will be displayed here once the fleet polling service
              is connected.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Events processed, bytes in/out, errors, uptime, and component
              health
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
