"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { ArrowLeft, Pencil, Trash2, Server, GitBranch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const statusColors: Record<string, string> = {
  HEALTHY: "bg-green-500/15 text-green-700 dark:text-green-400",
  DEGRADED: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  UNREACHABLE: "bg-red-500/15 text-red-700 dark:text-red-400",
  UNKNOWN: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

export default function EnvironmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const envQuery = useQuery(trpc.environment.get.queryOptions({ id }));
  const env = envQuery.data;

  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDeployMode, setEditDeployMode] = useState("");
  const [editGitRepo, setEditGitRepo] = useState("");
  const [editGitBranch, setEditGitBranch] = useState("");

  const updateMutation = useMutation(
    trpc.environment.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.environment.get.queryKey({ id }) });
        setEditing(false);
      },
    })
  );

  const deleteMutation = useMutation(
    trpc.environment.delete.mutationOptions({
      onSuccess: () => router.push("/environments"),
    })
  );

  function startEditing() {
    if (!env) return;
    setEditName(env.name);
    setEditDeployMode(env.deployMode);
    setEditGitRepo(env.gitRepo ?? "");
    setEditGitBranch(env.gitBranch ?? "");
    setEditing(true);
  }

  function handleSave() {
    updateMutation.mutate({
      id,
      name: editName,
      deployMode: editDeployMode as "API_RELOAD" | "GITOPS",
      gitRepo: editGitRepo || null,
      gitBranch: editGitBranch || null,
    });
  }

  if (envQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!env) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Environment not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/environments">Back to environments</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/environments">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{env.name}</h2>
            <p className="text-muted-foreground">
              {env.team.name} &middot;{" "}
              {env.deployMode === "API_RELOAD" ? "API Reload" : "GitOps"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </Button>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete environment?</DialogTitle>
                <DialogDescription>
                  This will permanently delete &ldquo;{env.name}&rdquo; and all
                  associated pipelines and nodes. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteMutation.mutate({ id })}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>Edit Environment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Deploy Mode</Label>
              <Select value={editDeployMode} onValueChange={setEditDeployMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="API_RELOAD">API Reload</SelectItem>
                  <SelectItem value="GITOPS">GitOps</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editDeployMode === "GITOPS" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit-git-repo">Git Repository</Label>
                  <Input
                    id="edit-git-repo"
                    value={editGitRepo}
                    onChange={(e) => setEditGitRepo(e.target.value)}
                    placeholder="https://github.com/org/repo.git or git@github.com:org/repo.git"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use HTTPS with a token (Settings &rarr; GitOps) or SSH with a deploy key
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-git-branch">Git Branch</Label>
                  <Input
                    id="edit-git-branch"
                    value={editGitBranch}
                    onChange={(e) => setEditGitBranch(e.target.value)}
                    placeholder="main"
                  />
                </div>
              </>
            )}
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Deploy Mode</CardDescription>
            <CardTitle className="flex items-center gap-2 text-lg">
              {env.deployMode === "GITOPS" ? (
                <GitBranch className="h-4 w-4" />
              ) : (
                <Server className="h-4 w-4" />
              )}
              {env.deployMode === "API_RELOAD" ? "API Reload" : "GitOps"}
            </CardTitle>
          </CardHeader>
          {env.deployMode === "GITOPS" && env.gitRepo && (
            <CardContent>
              <p className="truncate text-xs text-muted-foreground">
                {env.gitRepo}
                {env.gitBranch ? ` (${env.gitBranch})` : ""}
              </p>
            </CardContent>
          )}
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Nodes</CardDescription>
            <CardTitle className="text-lg">{env._count.nodes}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pipelines</CardDescription>
            <CardTitle className="text-lg">{env._count.pipelines}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Nodes Table */}
      <Card>
        <CardHeader>
          <CardTitle>Vector Nodes</CardTitle>
          <CardDescription>
            Nodes registered in this environment
          </CardDescription>
        </CardHeader>
        <CardContent>
          {env.nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No nodes in this environment yet
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href="/fleet">Go to Fleet</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {env.nodes.map((node) => (
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
                      <Badge
                        variant="secondary"
                        className={statusColors[node.status] ?? statusColors.UNKNOWN}
                      >
                        {node.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {node.lastSeen
                        ? new Date(node.lastSeen).toLocaleString()
                        : "Never"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Created info */}
      <p className="text-xs text-muted-foreground">
        Created {new Date(env.createdAt).toLocaleDateString()}
      </p>
    </div>
  );
}
