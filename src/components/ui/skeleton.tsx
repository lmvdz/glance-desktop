import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  // `.skeleton` (t3face.css) is the unison fixed-attachment sweep: every skeleton on screen shares
  // one continuous gradient tied to the viewport, instead of each box pulsing on its own clock. It
  // paints over a `bg-muted` base and self-disables under `.t3face-flat` / reduced-motion.
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton rounded-2xl bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
