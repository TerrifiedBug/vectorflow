import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[3px] font-medium transition-[color,background-color,border-color,box-shadow] duration-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default:
          "bg-bg-3 text-fg border border-line-2 hover:bg-bg-4",
        primary:
          "bg-accent-brand text-primary-foreground border border-accent-brand hover:bg-accent-brand-2 hover:border-accent-brand-2",
        destructive:
          "bg-transparent text-status-error border border-[color:var(--status-error)]/40 hover:bg-[color:var(--status-error-bg)]",
        outline:
          "bg-transparent text-fg border border-line-2 hover:bg-bg-3",
        secondary:
          "bg-bg-2 text-fg border border-line-2 hover:bg-bg-3",
        ghost:
          "bg-transparent text-fg-1 hover:bg-bg-3 hover:text-fg",
        link:
          "text-accent-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-7 px-2.5 text-[12px]",
        xs: "h-[22px] px-2 text-[11px] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 px-2.5 text-[12px]",
        md: "h-[34px] px-3.5 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-[38px] px-4 text-[13px]",
        icon: "size-7",
        "icon-xs": "size-[22px] rounded-[3px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-md": "size-[34px]",
        "icon-lg": "size-[38px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
