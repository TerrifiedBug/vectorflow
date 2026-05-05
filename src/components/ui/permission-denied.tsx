import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface PermissionDeniedProps {
  resource: string;
  owner?: string | null;
  requiredRole: string;
  className?: string;
}

/** Inline v2 permission-denied notice. Avoids full-screen blockers for scoped access gaps. */
export function PermissionDenied({
  resource,
  owner,
  requiredRole,
  className,
}: PermissionDeniedProps) {
  return (
    <div
      className={cn(
        "inline-flex items-start gap-2 rounded-[3px] border border-status-info/30 bg-status-info-bg px-3 py-2 font-mono text-[11.5px] leading-relaxed text-status-info",
        className,
      )}
      role="status"
    >
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        You don&apos;t have access to {resource}. Ask {owner || "an administrator"} for the {requiredRole} role.
      </span>
    </div>
  );
}
