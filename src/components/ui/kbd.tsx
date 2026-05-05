import * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center font-mono text-[10px] px-1.5 py-px",
        "bg-bg-3 text-fg-1 border border-line-2 border-b-2 rounded-[3px]",
        "leading-[1.4]",
        className,
      )}
      {...props}
    />
  );
}
