"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { nodeStatusVariant, nodeStatusLabel } from "@/lib/status";
import { formatLastSeen } from "@/lib/format";

interface NodeGroupDetailTableProps {
  groupId: string;
  environmentId: string;
}

export function NodeGroupDetailTable({
  groupId,
  environmentId,
}: NodeGroupDetailTableProps) {
  const trpc = useTRPC();

  const nodesQuery = useQuery(
    trpc.nodeGroup.nodesInGroup.queryOptions({ groupId, environmentId }),
  );

  if (nodesQuery.isLoading) {
    return (
      <div className="space-y-2 px-6 pb-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const nodes = nodesQuery.data ?? [];

  if (nodes.length === 0) {
    return (
      <div className="px-6 pb-4">
        <p className="text-sm text-muted-foreground">
          No nodes in this group.
        </p>
      </div>
    );
  }

  return (
    <div className="px-2 pb-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>CPU Load</TableHead>
            <TableHead>Last Seen</TableHead>
            <TableHead>Compliance</TableHead>
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
              <TableCell>
                <StatusBadge variant={nodeStatusVariant(node.status)}>
                  {nodeStatusLabel(node.status)}
                </StatusBadge>
              </TableCell>
              <TableCell className="tabular-nums text-sm">
                {node.cpuLoad != null
                  ? node.cpuLoad.toFixed(1)
                  : "--"}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {formatLastSeen(node.lastSeen)}
              </TableCell>
              <TableCell>
                {node.labelCompliant === false ? (
                  <Badge
                    variant="outline"
                    className="text-amber-600 border-amber-500/50"
                  >
                    Non-compliant
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-green-600 border-green-500/50"
                  >
                    Compliant
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
