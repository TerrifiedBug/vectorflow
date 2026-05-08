import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap rounded-[3px] border px-1.5 font-mono text-[11px] leading-[15px] tracking-[0.04em] uppercase transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/60 aria-invalid:border-destructive [&>svg]:size-2.5 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-line-2 bg-bg-2 text-fg-1",
        secondary: "border-line bg-bg-3 text-fg-1",
        destructive: "border-status-error/40 bg-status-error-bg text-status-error",
        outline: "border-line-2 bg-transparent text-fg-1 [a&]:hover:bg-bg-3 [a&]:hover:text-fg",
        ghost: "border-transparent bg-transparent text-fg-2 [a&]:hover:bg-bg-3 [a&]:hover:text-fg",
        link: "border-transparent bg-transparent text-accent-brand underline-offset-4 [a&]:hover:underline",
        status: "border-line-2 bg-bg-2 text-fg-1",
        ok: "border-accent-brand/40 bg-accent-soft text-accent-brand",
        warn: "border-status-degraded/40 bg-status-degraded-bg text-status-degraded",
        error: "border-status-error/40 bg-status-error-bg text-status-error",
        info: "border-status-info/40 bg-status-info-bg text-status-info",
        env: "border-line-2 bg-bg-3 text-fg-1",
        envProd: "border-accent-brand/40 bg-accent-soft text-accent-brand",
        kind: "border-line bg-bg-2 text-fg-2",
      },
      size: {
        default: "gap-1 px-1.5",
        sm: "gap-0.5 px-1 text-[11px] leading-[15px]",
      },
    },
    defaultVariants: {
      variant: "status",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
