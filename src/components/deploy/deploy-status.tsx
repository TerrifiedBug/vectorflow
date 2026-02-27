"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Server,
} from "lucide-react";

interface NodeResult {
  nodeId: string;
  nodeName: string;
  host: string;
  success: boolean;
  error?: string;
  healthAfter?: boolean;
}

interface DeployStatusProps {
  /** null = deployment in progress */
  nodeResults: NodeResult[] | null;
  isDeploying: boolean;
}

function NodeStatusIcon({
  result,
  isDeploying,
}: {
  result?: NodeResult;
  isDeploying: boolean;
}) {
  if (isDeploying || !result) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }
  if (result.success && result.healthAfter !== false) {
    return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  }
  if (result.success && result.healthAfter === false) {
    return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  }
  return <XCircle className="h-4 w-4 text-red-500" />;
}

export function DeployStatus({ nodeResults, isDeploying }: DeployStatusProps) {
  if (!nodeResults && !isDeploying) {
    return null;
  }

  const successCount = nodeResults?.filter((r) => r.success).length ?? 0;
  const totalCount = nodeResults?.length ?? 0;
  const allHealthy =
    nodeResults?.every((r) => r.success && r.healthAfter !== false) ?? false;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Deployment Status</CardTitle>
          {isDeploying && (
            <Badge variant="secondary">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Deploying...
            </Badge>
          )}
          {!isDeploying && nodeResults && allHealthy && (
            <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Success
            </Badge>
          )}
          {!isDeploying && nodeResults && !allHealthy && (
            <Badge variant="destructive">
              <XCircle className="mr-1 h-3 w-3" />
              {successCount}/{totalCount} Succeeded
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {nodeResults?.map((result) => (
            <div
              key={result.nodeId}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{result.nodeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {result.host}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {result.success && result.healthAfter === false && (
                  <span className="text-xs text-yellow-600 dark:text-yellow-400">
                    Deployed but unhealthy
                  </span>
                )}
                {result.error && (
                  <span className="max-w-[200px] truncate text-xs text-red-600 dark:text-red-400">
                    {result.error}
                  </span>
                )}
                <NodeStatusIcon result={result} isDeploying={false} />
              </div>
            </div>
          ))}

          {isDeploying && !nodeResults && (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span className="text-sm">
                Sending configuration to nodes...
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
