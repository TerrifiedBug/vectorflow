"use client";

import { ChevronDown, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { NodeGroupDetailTable } from "@/components/fleet/node-group-detail-table";
import { cn } from "@/lib/utils";

interface NodeGroupHealthCardProps {
  group: {
    id: string;
    name: string;
    environmentId: string;
    totalNodes: number;
    onlineCount: number;
    alertCount: number;
    complianceRate: number;
  };
  isExpanded: boolean;
  onToggle: () => void;
  labelFilterActive?: boolean;
}

export function NodeGroupHealthCard({
  group,
  isExpanded,
  onToggle,
  labelFilterActive = false,
}: NodeGroupHealthCardProps) {
  const allOnline = group.onlineCount === group.totalNodes;
  const hasAlerts = group.alertCount > 0;
  const fullyCompliant = group.complianceRate === 100;

  // Derive border class and status icon based on severity priority
  const borderClass = hasAlerts
    ? "border-l-4 border-l-destructive"
    : !fullyCompliant
      ? "border-l-4 border-l-amber-500"
      : "border-l-4 border-l-green-500";

  const StatusIcon = hasAlerts
    ? AlertTriangle
    : !fullyCompliant
      ? AlertCircle
      : CheckCircle2;

  const statusIconClass = hasAlerts
    ? "text-destructive"
    : !fullyCompliant
      ? "text-amber-500"
      : "text-green-500";

  const statusAriaLabel = hasAlerts
    ? `Critical: ${group.alertCount} active alerts`
    : !fullyCompliant
      ? "Degraded: partial compliance"
      : "Healthy: all nodes online";

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <Card className={cn("overflow-hidden", borderClass)}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full text-left focus:outline-none"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusIcon
                    className={cn("h-4 w-4 shrink-0", statusIconClass)}
                    aria-label={statusAriaLabel}
                  />
                  <CardTitle className="text-base">{group.name}</CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {group.totalNodes}{" "}
                    {group.totalNodes === 1 ? "node" : "nodes"}
                  </Badge>
                  {labelFilterActive && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      Label filter active
                    </Badge>
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200",
                    isExpanded && "rotate-180",
                  )}
                />
              </div>
            </CardHeader>
            <CardContent className="pt-0 pb-4">
              <div className="flex items-center gap-6 text-sm">
                {/* Online metric */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Online</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      allOnline
                        ? "text-green-600 dark:text-green-400"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {group.onlineCount}/{group.totalNodes}
                  </span>
                </div>

                <div className="h-8 w-px bg-border" />

                {/* Alerts metric */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Alerts</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      hasAlerts
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {group.alertCount}
                  </span>
                </div>

                <div className="h-8 w-px bg-border" />

                {/* Compliance metric */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    Compliance
                  </span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      fullyCompliant
                        ? "text-green-600 dark:text-green-400"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {group.complianceRate}%
                  </span>
                </div>
              </div>
            </CardContent>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t">
            <NodeGroupDetailTable
              groupId={group.id}
              environmentId={group.environmentId}
            />
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
