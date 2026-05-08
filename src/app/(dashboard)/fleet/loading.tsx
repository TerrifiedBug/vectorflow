import { TableSkeleton } from "@/components/ui/loading-skeletons";

export default function FleetLoading() {
  return (
    <div className="space-y-6">
      <TableSkeleton rows={6} />
    </div>
  );
}
