// Attention pill (t3-face concern 07 — DESIGN.md's "Attention ladder" row). Renders the daemon's
// ONE server-computed priority tier (`FleetUnit.ladderPriority`, from concern 06's `GET /api/agents`
// overlay) in the t3 status grammar: a token-resolved dot + a `text-[10px]` label, `animate-status-
// pulse` only on the in-flight `working` tier, and a compact (dot-only) variant for the row's
// leading slot and the group-header roll-up. Concern 05 built this component against the client's
// own `FleetStatus`; concern 07 swaps its input to the server tier and deletes the client ranking —
// the layout is unchanged, only the DATA SOURCE moved. The tier→token mapping lives in fleetLadder.ts
// (`ladderMeta`) so it repaints under any theme (raw palette colors are deliberately not hardcoded).

import { type LadderPriority, ladderMeta } from "../lib/fleetLadder";

export interface AttentionPillProps {
  /** The daemon's tier for this unit (undefined ⇒ pre-concern-06 daemon → renders as `idle`). */
  priority: LadderPriority | undefined;
  /** The attention reason text (fleetLadder's `ladderReason()`) — becomes the tooltip when present;
   *  falls back to the bare tier label otherwise. */
  reason?: string;
  /** Dot-only, no text label — the row's compact leading slot and the group-header roll-up. */
  compact?: boolean;
  className?: string;
}

/** A unit row's attention pill: dot + compact tier label, `animate-status-pulse` on the working
 *  tier, a tooltip carrying the fuller reason. */
export function AttentionPill({
  priority,
  reason,
  compact,
  className,
}: AttentionPillProps) {
  const meta = ladderMeta(priority);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 ${className ?? ""}`}
      title={reason || meta.label}
    >
      <span
        role="img"
        aria-label={meta.label}
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot} ${
          meta.pulse ? "animate-status-pulse" : ""
        }`}
      />
      {!compact && (
        <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {meta.label}
        </span>
      )}
    </span>
  );
}

/** The group-header roll-up dot — the group's most-urgent unit's tier (`maxLadderPriority`), shown
 *  in the chevron slot and crossfaded to the chevron on header hover (t3's `group/project-header`
 *  idiom — see GroupHeader.tsx). Always compact (dot-only) by construction. */
export function RollupDot({
  priority,
  className,
}: {
  priority: LadderPriority | undefined;
  className?: string;
}) {
  const meta = ladderMeta(priority);
  return (
    <span
      role="img"
      aria-label={`group status: ${meta.label}`}
      className={`h-2 w-2 shrink-0 rounded-full ${meta.dot} ${
        meta.pulse ? "animate-status-pulse" : ""
      } ${className ?? ""}`}
    />
  );
}
