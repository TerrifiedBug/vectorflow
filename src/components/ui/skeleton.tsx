import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-accent via-accent/40 to-accent rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
