import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function KpiSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-[3px] border border-line bg-bg-2 p-3", className)}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-24" />
      <Skeleton className="mt-2 h-3 w-32" />
    </div>
  );
}

export function TableSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("rounded-[3px] border border-line bg-bg-2", className)}>
      <div className="grid grid-cols-5 gap-3 border-b border-line bg-bg-1 p-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-3 w-full" />
        ))}
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, row) => (
          <div key={row} className="grid grid-cols-5 gap-3 p-3">
            {Array.from({ length: 5 }).map((_, col) => (
              <Skeleton key={col} className="h-4 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-[3px] border border-line bg-bg-2 p-4", className)}>
      <Skeleton className="h-4 w-40" />
      <div className="mt-4 h-60 rounded-[3px] border border-line bg-[linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] [background-size:48px_48px] opacity-80" />
    </div>
  );
}
