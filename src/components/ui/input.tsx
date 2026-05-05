import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-7 w-full min-w-0 rounded-[3px] border border-line-2 bg-bg-2 px-2.5 text-[12px] text-fg",
        "placeholder:text-fg-2 selection:bg-accent-soft selection:text-accent-brand",
        "transition-[color,border-color,box-shadow] outline-none",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-[12px] file:font-medium file:text-fg",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-accent-brand focus-visible:ring-2 focus-visible:ring-accent-soft",
        "aria-invalid:border-status-error aria-invalid:ring-2 aria-invalid:ring-[color:var(--status-error)]/20",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
