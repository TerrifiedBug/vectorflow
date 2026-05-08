import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse bg-bg-3 rounded-[3px]",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
