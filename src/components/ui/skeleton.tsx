import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-bg-3 via-bg-2 to-bg-3 rounded-[3px]",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
