"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Plus, Trash2, RotateCcw, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface SecretsSectionProps {
  environmentId: string;
}

export function SecretsSection({ environmentId }: SecretsSectionProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const secretsQuery = useQuery(
    trpc.secret.list.queryOptions({ environmentId })
  );
  const secrets = secretsQuery.data ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addValue, setAddValue] = useState("");

  const [updateTarget, setUpdateTarget] = useState<{ id: string; name: string } | null>(null);
  const [updateValue, setUpdateValue] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const createMutation = useMutation(
    trpc.secret.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.secret.list.queryKey({ environmentId }) });
        toast.success("Secret created");
        setAddOpen(false);
        setAddName("");
        setAddValue("");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create secret");
      },
    })
  );

  const updateMutation = useMutation(
    trpc.secret.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.secret.list.queryKey({ environmentId }) });
        toast.success("Secret updated");
        setUpdateTarget(null);
        setUpdateValue("");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update secret");
      },
    })
  );

  const deleteMutation = useMutation(
    trpc.secret.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.secret.list.queryKey({ environmentId }) });
        toast.success("Secret deleted");
        setDeleteTarget(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete secret");
      },
    })
  );

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({ environmentId, name: addName, value: addValue });
  }

  function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!updateTarget) return;
    updateMutation.mutate({ id: updateTarget.id, environmentId, value: updateValue });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                Secrets
              </CardTitle>
              <CardDescription>
                Encrypted key-value secrets available to pipelines in this environment.
                Reference them in pipeline config fields as secret references.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Add Secret
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {secrets.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <Lock className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No secrets configured for this environment
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Secrets are encrypted at rest and can be referenced in pipeline configs
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {secrets.map((secret) => (
                  <TableRow key={secret.id}>
                    <TableCell className="font-mono text-sm font-medium">
                      {secret.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(secret.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(secret.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Update value"
                        onClick={() => {
                          setUpdateTarget({ id: secret.id, name: secret.name });
                          setUpdateValue("");
                        }}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => setDeleteTarget({ id: secret.id, name: secret.name })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Secret Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Secret</DialogTitle>
            <DialogDescription>
              Create a new encrypted secret for this environment.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="secret-name">Name</Label>
              <Input
                id="secret-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="MY_API_KEY"
                pattern="^[a-zA-Z0-9][a-zA-Z0-9_-]*$"
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Start with a letter or number. Only letters, numbers, hyphens, and underscores.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret-value">Value</Label>
              <Input
                id="secret-value"
                type="password"
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Secret"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Update Secret Dialog */}
      <Dialog open={!!updateTarget} onOpenChange={(open) => !open && setUpdateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Secret</DialogTitle>
            <DialogDescription>
              Set a new value for <span className="font-mono font-semibold">{updateTarget?.name}</span>.
              The previous value cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="secret-update-value">New Value</Label>
              <Input
                id="secret-update-value"
                type="password"
                value={updateValue}
                onChange={(e) => setUpdateValue(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setUpdateTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Updating..." : "Update Secret"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Secret"
        description={
          <>
            Permanently delete the secret{" "}
            <span className="font-mono font-semibold">{deleteTarget?.name}</span>?
            Any pipeline configs referencing this secret will fail at deploy time.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id, environmentId });
          }
        }}
      />
    </>
  );
}
