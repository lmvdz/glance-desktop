// Layered-card empty state for the fleet cockpit (t3-face concern 11). t3code's empty-state idiom
// (pingdotgg/t3code, components/ui/empty.tsx, MIT): an icon card in front with two rotated ghost
// cards fanned behind it — a small card-stack that reads as "there could be things here" instead of
// a bare centered gray line. Composed over the shadcn `Empty` primitives (components/ui/empty.tsx);
// values re-authored against glance's own tokens. All static transforms — nothing animates, so
// there's nothing for reduced-motion to suppress.

import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

type FleetEmptyIcon = React.ComponentProps<typeof HugeiconsIcon>["icon"];

/** The icon card + two rotated ghost cards fanned behind it. */
function CardStackMedia({ icon }: { icon: FleetEmptyIcon }) {
  return (
    <div className="relative mb-1 flex size-10 items-center justify-center">
      <span
        aria-hidden
        className="absolute size-10 -rotate-6 rounded-xl border border-border/50 bg-muted/40"
      />
      <span
        aria-hidden
        className="absolute size-10 rotate-6 rounded-xl border border-border/50 bg-muted/60"
      />
      <span className="relative flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted text-foreground">
        <HugeiconsIcon icon={icon} size={20} strokeWidth={1.75} />
      </span>
    </div>
  );
}

export function FleetEmpty({
  icon,
  title,
  description,
  compact = false,
  className,
  children,
}: {
  icon: FleetEmptyIcon;
  title: string;
  description?: ReactNode;
  /** Tighter padding + smaller type for narrow slots (the spine column, the inline transcript). */
  compact?: boolean;
  className?: string;
  /** Actions or supporting content rendered below the description (retry buttons, links). */
  children?: ReactNode;
}) {
  return (
    <Empty
      className={cn(
        "border-0",
        compact ? "flex-none gap-2.5 p-6" : "p-8",
        className,
      )}
    >
      <EmptyHeader>
        <CardStackMedia icon={icon} />
        <EmptyTitle className={compact ? "text-sm" : undefined}>
          {title}
        </EmptyTitle>
        {description && (
          <EmptyDescription className={compact ? "text-[12px]" : undefined}>
            {description}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
