"use client";

import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { findComponentDef } from "@/lib/vector/catalog";
import { toast } from "sonner";
import {
  ExternalLink,
  Link2,
  Loader2,
  Save,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Breadcrumb } from "@/components/breadcrumb";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SchemaForm } from "@/components/config-forms/schema-form";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";

/* ------------------------------------------------------------------ */
/*  Kind badge styling                                                 */
/* ------------------------------------------------------------------ */

const kindVariant: Record<string, string> = {
  SOURCE:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  TRANSFORM:
    "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  SINK: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
};

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function SharedComponentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const componentQuery = useQuery(
    trpc.sharedComponent.getById.queryOptions(
      { id: params.id, environmentId: selectedEnvironmentId! },
      {
        enabled: !!selectedEnvironmentId && !!params.id,
      },
    ),
  );

  const sc = componentQuery.data;

  // Initialize form state from fetched data
  if (sc && !initialized) {
    setName(sc.name);
    setDescription(sc.description ?? "");
    setConfig((sc.config as Record<string, unknown>) ?? {});
    setInitialized(true);
  }

  const componentDef = sc
    ? findComponentDef(sc.componentType, sc.kind.toLowerCase() as "source" | "transform" | "sink")
    : undefined;

  const handleNameChange = useCallback((val: string) => {
    setName(val);
    setHasChanges(true);
  }, []);

  const handleDescriptionChange = useCallback((val: string) => {
    setDescription(val);
    setHasChanges(true);
  }, []);

  const handleConfigChange = useCallback((vals: Record<string, unknown>) => {
    setConfig(vals);
    setHasChanges(true);
  }, []);

  const updateMutation = useMutation(
    trpc.sharedComponent.update.mutationOptions({
      onSuccess: () => {
        toast.success("Shared component updated");
        setHasChanges(false);
        queryClient.invalidateQueries({
          queryKey: trpc.sharedComponent.getById.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.sharedComponent.list.queryKey(),
        });
      },
      onError: (err) => {
        toast.error(err.message, { duration: 6000 });
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.sharedComponent.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Shared component deleted");
        router.push("/library/shared-components");
      },
      onError: (err) => {
        toast.error(err.message, { duration: 6000 });
      },
    }),
  );

  const handleSave = () => {
    if (!sc || !selectedEnvironmentId) return;
    updateMutation.mutate({
      id: sc.id,
      environmentId: selectedEnvironmentId,
      name,
      description: description || null,
      config,
    });
  };

  const handleDelete = () => {
    if (!sc || !selectedEnvironmentId) return;
    deleteMutation.mutate({ id: sc.id, environmentId: selectedEnvironmentId });
  };

  if (!selectedEnvironmentId) {
    return (
      <div className="p-6">
        <EmptyState title="Select an environment from the header to view this component" className="p-4 text-sm" />
      </div>
    );
  }

  if (componentQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (componentQuery.isError) {
    return (
      <div className="p-6">
        <QueryError message="Failed to load shared component" onRetry={() => componentQuery.refetch()} />
      </div>
    );
  }

  if (!sc) {
    return (
      <div className="p-6">
        <EmptyState title="Shared component not found" className="p-4 text-sm" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Back + Header */}
      <div className="space-y-4">
        <Breadcrumb items={[
          { label: "Library", href: "/library" },
          { label: "Shared Components", href: "/library/shared-components" },
          { label: sc.name },
        ]} />

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{sc.name}</h1>
              <Badge variant="outline" className={kindVariant[sc.kind] ?? ""}>
                {sc.kind}
              </Badge>
              <Badge variant="secondary">v{sc.version}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {sc.componentType} &middot; {sc.linkedPipelines.length} linked{" "}
              {sc.linkedPipelines.length === 1 ? "pipeline" : "pipelines"}
            </p>
          </div>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {updateMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Details card */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  placeholder="Optional description..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Config card */}
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>
                Edit the component configuration below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {componentDef ? (
                <SchemaForm
                  schema={componentDef.configSchema as { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[] }}
                  values={config}
                  onChange={handleConfigChange}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Component definition not found for type &quot;{sc.componentType}&quot;.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Linked pipelines card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Linked Pipelines
              </CardTitle>
              <CardDescription>
                Pipelines using this shared component
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sc.linkedPipelines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pipelines are linked to this component.
                </p>
              ) : (
                <div className="space-y-3">
                  {sc.linkedPipelines.map((pipeline) => (
                    <div
                      key={pipeline.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-sm font-medium">
                          {pipeline.name}
                        </span>
                        {pipeline.isStale ? (
                          <Badge
                            variant="outline"
                            className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 shrink-0"
                          >
                            Update pending
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 shrink-0"
                          >
                            Up to date
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        asChild
                        className="shrink-0"
                      >
                        <Link href={`/pipelines/${pipeline.id}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Danger zone */}
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
              <CardDescription>
                Permanently delete this shared component. All linked pipeline
                nodes will be unlinked.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Component
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete shared component?"
        description={
          <>
            Permanently delete{" "}
            <span className="font-medium">{sc.name}</span>? All linked pipeline
            nodes will be unlinked. This action cannot be undone.
          </>
        }
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={handleDelete}
      />
    </div>
  );
}
