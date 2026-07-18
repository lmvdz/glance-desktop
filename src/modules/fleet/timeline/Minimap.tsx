// Right-edge minimap rail — one dot per user message, positioned by ARRAY INDEX (t3-face C04: `seq`
// is manager-global with gaps, so it would misplace dots relative to how far through the visible
// conversation they actually sit). Geometry helpers are a value-only port of t3code's
// MessagesTimeline.logic.ts constants (see deriveRows.ts); this component is glance-original.

import { cn } from "@/lib/utils";
import {
  TIMELINE_MINIMAP_MIN_ITEMS,
  type MinimapDot,
  resolveTimelineMinimapHeightStyle,
  resolveTimelineMinimapTopPercent,
} from "./deriveRows";

export function Minimap({
  dots,
  onSelect,
}: {
  dots: MinimapDot[];
  onSelect: (id: string) => void;
}) {
  // A rail with 0 or 1 dot has nothing to scrub between — not worth the visual noise.
  if (dots.length < TIMELINE_MINIMAP_MIN_ITEMS) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a nav landmark for a scrub rail, not a menu
    <div
      className="sticky top-1 flex w-3 shrink-0 justify-center self-start"
      style={{ height: resolveTimelineMinimapHeightStyle(dots.length) }}
      role="navigation"
      aria-label="Jump to a message in this conversation"
    >
      <div className="relative h-full w-1.5">
        {dots.map((dot, i) => (
          <button
            key={dot.id}
            type="button"
            onClick={() => onSelect(dot.id)}
            title="Jump to message"
            style={{ top: `${resolveTimelineMinimapTopPercent(i, dots.length)}%` }}
            className={cn(
              "absolute left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
              "bg-muted-foreground/35 transition-colors hover:bg-muted-foreground/70",
            )}
          />
        ))}
      </div>
    </div>
  );
}
