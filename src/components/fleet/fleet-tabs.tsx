import Link from "next/link";
import { cn } from "@/lib/utils";

const ACTIVE_CLASSES =
  "bg-accent text-accent-foreground border-transparent";
const INACTIVE_CLASSES =
  "bg-transparent text-muted-foreground border-border hover:bg-muted";
const BASE_CLASSES =
  "rounded-full px-3 h-7 text-xs font-medium border transition-colors inline-flex items-center";

interface FleetTabsProps {
  active: "nodes" | "overview" | "health";
}

export function FleetTabs({ active }: FleetTabsProps) {
  return (
    <div className="flex items-center gap-1">
      {active === "nodes" ? (
        <span className={cn(BASE_CLASSES, ACTIVE_CLASSES)}>Nodes</span>
      ) : (
        <Link href="/fleet" className={cn(BASE_CLASSES, INACTIVE_CLASSES)}>
          Nodes
        </Link>
      )}
      {active === "overview" ? (
        <span className={cn(BASE_CLASSES, ACTIVE_CLASSES)}>Overview</span>
      ) : (
        <Link href="/fleet/overview" className={cn(BASE_CLASSES, INACTIVE_CLASSES)}>
          Overview
        </Link>
      )}
      {active === "health" ? (
        <span className={cn(BASE_CLASSES, ACTIVE_CLASSES)}>Health</span>
      ) : (
        <Link href="/fleet/health" className={cn(BASE_CLASSES, INACTIVE_CLASSES)}>
          Health
        </Link>
      )}
    </div>
  );
}
