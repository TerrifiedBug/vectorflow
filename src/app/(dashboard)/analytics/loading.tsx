import { ChartSkeleton, KpiSkeleton, TableSkeleton } from "@/components/ui/loading-skeletons";

export default function AnalyticsLoading() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
      <ChartSkeleton />
      <TableSkeleton rows={5} />
    </div>
  );
}
