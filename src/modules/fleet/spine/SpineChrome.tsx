// Shared spine chrome (t3-face C05/C11) reused by the live ThreadSpine and by the
// pre-connection SpineScaffold (C13-F2), so the list-left silhouette and the unison
// skeleton sweep are defined once and never drift between the connected and
// connecting/offline states.

import { DashboardCircleIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/** The spine's header row: the "Fleet" identity on the left (with an optional unit
 *  count), a caller-supplied status node on the right (live/connecting/etc), and — when
 *  connected — a "New thread" verb (t3's primary action; t3-face C13-F4) that starts a
 *  daemon console chat. `onNewThread` is omitted by the pre-connection scaffold, where
 *  there's no daemon to chat with. */
export function SpineHeader({
  count,
  right,
  onNewThread,
}: {
  count?: number;
  right?: ReactNode;
  onNewThread?: () => void;
}) {
  return (
    <header className="surface-subheader justify-between px-3">
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={DashboardCircleIcon}
          size={15}
          className="text-muted-foreground"
        />
        <span className="text-[13px] font-semibold text-foreground">Fleet</span>
        {count !== undefined && (
          <span className="text-[11px] text-muted-foreground/70">
            {count} unit{count === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onNewThread && (
          <button
            type="button"
            onClick={onNewThread}
            title="Start a new chat thread with this daemon"
            className="flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border/60 px-1.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={12} />
            New thread
          </button>
        )}
        {right}
      </div>
    </header>
  );
}

/** Ghost unit rows while the first roster fetch is in flight — the unison skeleton
 *  sweep (t3-face C11), so a cold spine paints its shape immediately instead of a
 *  blank column or a "Loading…" line. */
export function SpineSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-2 py-1" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex h-7 items-center gap-2 px-2">
          <Skeleton className="size-1.5 rounded-full" />
          <Skeleton className="h-3 rounded" style={{ width: `${70 - i * 8}%` }} />
        </div>
      ))}
    </div>
  );
}
