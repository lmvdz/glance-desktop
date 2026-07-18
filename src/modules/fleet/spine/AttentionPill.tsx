// Attention pill v1 (t3-face concern 05, DESIGN.md's "Attention ladder" row). Renders the fleet's
// EXISTING client attention state — `fleetRoster.ts`'s `rankUnit()`/`attentionUnits()`/
// `attentionReason()` (the task brief names `fleetAttention.ts` for these; that file actually
// holds the notification-collapse logic for the OS-notification bell — the roster ranking/reason
// helpers this pill renders live in fleetRoster.ts, which is what RosterView's old STATUS_DOT
// table and "Needs you" section were already built on). This component does NOT invent a new
// ranking: concern 07 swaps the DATA SOURCE to the daemon's `/api/attention/ladder` and deletes
// fleetRoster's client-side `rankUnit`, but this pill's props (`status`, `reason`) stay the same
// shape — 07 is a data-source change here, not a re-layout.

import type { FleetStatus } from "../lib/fleetRoster";

interface StatusMeta {
  dot: string;
  label: string;
  /** Duty-cycled `animate-status-pulse` (t3face.css) — "working" and "starting" are the two
   *  in-flight states (the brief's "working/connecting"; FleetStatus has no literal "connecting" —
   *  "starting" is glance's equivalent: process spawned, awaiting ready). */
  pulse?: boolean;
}

const STATUS_META: Record<FleetStatus, StatusMeta> = {
  input: { dot: "bg-destructive", label: "input" },
  error: { dot: "bg-destructive", label: "error" },
  working: { dot: "bg-success", label: "working", pulse: true },
  idle: { dot: "bg-muted-foreground/60", label: "idle" },
  starting: { dot: "bg-warning", label: "starting", pulse: true },
  stopped: { dot: "bg-muted-foreground", label: "stopped" },
};

export function statusMeta(status: FleetStatus): StatusMeta {
  return STATUS_META[status];
}

export interface AttentionPillProps {
  status: FleetStatus;
  /** The attention reason text (fleetRoster's `attentionReason()`) — becomes the tooltip when
   *  present; falls back to the bare status label otherwise. */
  reason?: string;
  /** Dot-only, no text label — the row's compact leading slot and the group-header roll-up. */
  compact?: boolean;
  className?: string;
}

/** A unit row's attention pill: dot + compact status label, `animate-status-pulse` on in-flight
 *  states, a tooltip carrying the fuller reason. */
export function AttentionPill({
  status,
  reason,
  compact,
  className,
}: AttentionPillProps) {
  const meta = STATUS_META[status];
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

/** The group-header roll-up dot — the group's highest-priority unit's status, shown in the
 *  chevron slot and crossfaded to the chevron on header hover (t3's `group/project-header`
 *  idiom — see GroupHeader.tsx). Always compact (dot-only) by construction. */
export function RollupDot({
  status,
  className,
}: {
  status: FleetStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
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
