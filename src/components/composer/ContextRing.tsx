// Context/cost ring for the composer footer (hub-shell H4, r3 borrow — plans/research-t3code
// round 3). t3code's ContextWindowMeter idiom (© 2026 T3 Tools Inc., MIT License): a small SVG
// ring showing context-window usage, flipping to the destructive color past 90%, with the
// numbers in the tooltip rather than inline — the footer stays calm. Renders nothing without a
// percentage: an absent metric must read as absent, never as 0% (honesty rule).

import { formatCompactCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const RING_SIZE = 18;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Past this usage the ring reads as a warning (t3's `isOverloaded` threshold). */
export const CONTEXT_RING_OVERLOAD_PCT = 90;

export function ContextRing({
  pct,
  costUsd,
  tokens,
  className,
}: {
  /** Context-window usage 0–100, as the daemon reports it (`contextPct`). */
  pct?: number;
  costUsd?: number;
  tokens?: number;
  className?: string;
}) {
  if (pct == null || Number.isNaN(pct)) return null;
  const clamped = Math.max(0, Math.min(100, pct));
  const overloaded = clamped > CONTEXT_RING_OVERLOAD_PCT;

  const parts = [`Context ${Math.round(clamped)}%`];
  if (costUsd != null) parts.push(`$${costUsd.toFixed(2)}`);
  if (tokens != null) parts.push(`${formatCompactCount(tokens)} tokens`);

  return (
    <span
      title={parts.join(" · ")}
      className={cn("inline-flex shrink-0 items-center", className)}
      role="img"
      aria-label={parts.join(", ")}
    >
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative — the labeled parent span carries the accessible name; the svg is aria-hidden */}
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          className="stroke-muted-foreground/25"
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped / 100)}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          className={cn(
            "transition-[stroke-dashoffset] duration-500",
            overloaded ? "stroke-destructive" : "stroke-info",
          )}
        />
      </svg>
    </span>
  );
}
