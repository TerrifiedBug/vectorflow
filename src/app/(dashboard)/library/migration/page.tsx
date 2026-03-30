"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import {
  ArrowRightLeft,
  Plus,
  Trash2,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  FileText,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
> = {
  DRAFT: { label: "Draft", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
  PARSING: { label: "Parsing", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  TRANSLATING: { label: "Translating", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  VALIDATING: { label: "Validating", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  READY: { label: "Ready", variant: "default", icon: <CheckCircle className="h-3 w-3" /> },
  GENERATING: { label: "Generating", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  COMPLETED: { label: "Completed", variant: "default", icon: <CheckCircle className="h-3 w-3" /> },
  FAILED: { label: "Failed", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
};

const PLATFORMS = [
  {
    id: "FLUENTD" as const,
    name: "FluentD",
    description: "Migrate from FluentD log pipelines to Vector",
    available: true,
  },
  {
    id: "FLUENT_BIT" as const,
    name: "Fluent Bit",
    description: "Migrate from Fluent Bit pipelines to Vector",
    available: false,
  },
  {
    id: "LOGSTASH" as const,
    name: "Logstash",
    description: "Migrate from Logstash pipelines to Vector",
    available: false,
  },
];

export default function MigrationPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const projectsQuery = useQuery(
    trpc.migration.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );

  const projects = projectsQuery.data ?? [];

  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const deleteMutation = useMutation(
    trpc.migration.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.migration.list.queryKey(),
        });
        setDeleteConfirm(null);
      },
    }),
  );

  return (
    <div className="space-y-8">
      {/* Supported Platforms */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Supported Platforms</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {PLATFORMS.map((platform) => (
            <Card
              key={platform.id}
              className={platform.available ? "cursor-pointer hover:border-primary/50 transition-colors" : "opacity-50"}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4" />
                  {platform.name}
                  {!platform.available && (
                    <Badge variant="outline" className="text-xs">
                      Coming Soon
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">
                  {platform.description}
                </CardDescription>
              </CardHeader>
              {platform.available && (
                <CardFooter className="pt-2">
                  <Button
                    size="sm"
                    onClick={() => router.push("/library/migration/new")}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Start Migration
                  </Button>
                </CardFooter>
              )}
            </Card>
          ))}
        </div>
      </section>

      {/* Migration Projects */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Migration Projects</h2>
          <Button size="sm" onClick={() => router.push("/library/migration/new")}>
            <Plus className="h-4 w-4 mr-1" />
            New Migration
          </Button>
        </div>

        {projectsQuery.isError ? (
          <QueryError
            message="Failed to load migration projects"
            onRetry={() => projectsQuery.refetch()}
          />
        ) : projectsQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No migration projects yet"
            description="Start a new migration to analyze and translate your FluentD configs."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const statusConfig = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.DRAFT;
              return (
                <Card
                  key={project.id}
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() =>
                    router.push(`/library/migration/${project.id}`)
                  }
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base truncate">
                        {project.name}
                      </CardTitle>
                      <Badge variant={statusConfig.variant} className="shrink-0 gap-1">
                        {statusConfig.icon}
                        {statusConfig.label}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">
                      {project.platform} migration
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-2">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {project.readinessScore !== null && (
                        <span className="flex items-center gap-1">
                          {project.readinessScore >= 70 ? (
                            <CheckCircle className="h-3 w-3 text-green-500" />
                          ) : project.readinessScore >= 40 ? (
                            <AlertTriangle className="h-3 w-3 text-yellow-500" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-500" />
                          )}
                          {project.readinessScore}% ready
                        </span>
                      )}
                      {project.generatedPipelineId && (
                        <span className="flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" />
                          Pipeline generated
                        </span>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0 flex justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm({
                          id: project.id,
                          name: project.name,
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title="Delete migration project?"
        description={
          <>
            Permanently delete{" "}
            <span className="font-medium">{deleteConfirm?.name}</span>? This
            action cannot be undone. The generated pipeline (if any) will not be
            deleted.
          </>
        }
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (!deleteConfirm || !selectedTeamId) return;
          deleteMutation.mutate({
            id: deleteConfirm.id,
            teamId: selectedTeamId,
          });
        }}
      />
    </div>
  );
}
