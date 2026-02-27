"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  ArrowLeft,
  Clock,
  RotateCcw,
  Eye,
  Loader2,
  Tag,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function VersionHistoryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const pipelineId = params.id;

  const [viewingConfig, setViewingConfig] = useState<{
    version: number;
    yaml: string;
  } | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  // Fetch pipeline info
  const pipelineQuery = useQuery(
    trpc.pipeline.get.queryOptions({ id: pipelineId }),
  );

  // Fetch versions
  const versionsQuery = useQuery(
    trpc.pipeline.versions.queryOptions({ pipelineId }),
  );

  // Rollback mutation
  const rollbackMutation = useMutation(
    trpc.pipeline.rollback.mutationOptions({
      onSuccess: (newVersion) => {
        toast.success(
          `Rolled back to version ${newVersion.version}`,
        );
        setRollingBack(null);
        // Invalidate versions list
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.versions.queryKey({ pipelineId }),
        });
      },
      onError: (err) => {
        toast.error(err.message || "Rollback failed");
        setRollingBack(null);
      },
    }),
  );

  const handleRollback = (versionId: string) => {
    setRollingBack(versionId);
    rollbackMutation.mutate({
      pipelineId,
      targetVersionId: versionId,
    });
  };

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isLoading = pipelineQuery.isLoading || versionsQuery.isLoading;
  const versions = versionsQuery.data ?? [];
  const latestVersion = versions.length > 0 ? versions[0] : null;

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push(`/pipelines/${pipelineId}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            Version History
          </h1>
          <p className="text-sm text-muted-foreground">
            {pipelineQuery.data?.name} — {versions.length} version
            {versions.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Versions Table */}
      {versions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Tag className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-4 text-sm text-muted-foreground">
              No versions yet. Deploy your pipeline to create the first version.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() =>
                router.push(`/pipelines/${pipelineId}/deploy`)
              }
            >
              Go to Deploy
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All Versions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Version</TableHead>
                  <TableHead>Changelog</TableHead>
                  <TableHead className="w-[180px]">Created</TableHead>
                  <TableHead className="w-[120px] text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((version) => {
                  const isCurrent =
                    latestVersion?.id === version.id;
                  return (
                    <TableRow key={version.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium">
                            v{version.version}
                          </span>
                          {isCurrent && (
                            <Badge
                              variant="secondary"
                              className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 text-xs"
                            >
                              Current
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {version.changelog || "No changelog"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDate(version.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="View config"
                            onClick={() =>
                              setViewingConfig({
                                version: version.version,
                                yaml: version.configYaml,
                              })
                            }
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {!isCurrent && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Rollback to this version"
                              disabled={rollbackMutation.isPending}
                              onClick={() =>
                                handleRollback(version.id)
                              }
                            >
                              {rollingBack === version.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Config Viewer Dialog */}
      <Dialog
        open={viewingConfig !== null}
        onOpenChange={(open) => {
          if (!open) setViewingConfig(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Version {viewingConfig?.version} Configuration
            </DialogTitle>
            <DialogDescription>
              Full YAML configuration snapshot for this version
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[500px] rounded-md border">
            <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
              {viewingConfig?.yaml}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
