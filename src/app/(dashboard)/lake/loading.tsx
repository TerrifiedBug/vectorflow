import { TableSkeleton } from "@/components/ui/loading-skeletons";

export default function LakeLoading() {
  return (
    <div className="space-y-6 p-4">
      <TableSkeleton rows={3} />
      <TableSkeleton rows={8} />
    </div>
  );
}
