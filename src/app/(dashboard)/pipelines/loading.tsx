import { Skeleton } from "@/components/ui/skeleton";

export default function PipelinesLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-48" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
