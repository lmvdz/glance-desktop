// The needs-you ladder, cockpit side (t3-face concern 07 — see plans/t3-face/07-spine-server-ladder.md).
//
// The daemon (concern 06, omp-squad `src/attention-ladder.ts`) computes ONE priority state per unit
// and rides it on every `GET /api/agents` DTO as `ladderPriority` (viewer-personalized server-side).
// The cockpit is a pure RENDERER of that verdict: nothing here re-derives a unit's tier from raw
// signals (agent status / pending / land / validation) the way the deleted `fleetRoster.rankUnit`
// did. This module only (a) mirrors the server's published tier ORDER so a roster sort or a group
// roll-up can order/aggregate the server's own tiers, and (b) maps each tier to the t3 status
// grammar — a token + label + pulse. Both are presentation over a server truth, not a second
// ranking.
//
// `LADDER_RANK` / `maxLadderPriority` are a faithful mirror of the daemon's exported
// `LADDER_RANK` / `maxLadderPriority` (the same way the old `rankUnit` mirrored the daemon TUI's
// `agentRank`). The daemon's own `GET /api/attention/ladder` roll-up is keyed by raw repo path for a
// SINGLE daemon; the cockpit spine groups by project (repoName) across MERGED daemons (concern 05),
// so a group roll-up here is `maxLadderPriority` over that group's units' server tiers — the exact
// function the daemon runs, applied at the cockpit's own grouping granularity. See the PR body's
// "spec deviation" note.

import type { FleetUnit } from "./fleetRoster";

/** The daemon's ranked priority cascade, highest-urgency first — mirrors omp-squad
 *  `attention-ladder.ts`'s `LadderPriority`. `working` folds the daemon's "working" and "starting"
 *  ("connecting") states; there is no separate `connecting` tier. */
export type LadderPriority =
  | "error"
  | "pending-approval"
  | "awaiting-input"
  | "working"
  | "plan-ready"
  | "completed-unseen"
  | "idle";

/** Same order the daemon's `computeLadderPriority` cascade implements — highest-urgency first.
 *  Mirrors omp-squad `attention-ladder.ts`'s exported `LADDER_RANK` so the cockpit never invents a
 *  second ordering; a roster sort or a group roll-up folds the SERVER's tiers by this shared list. */
export const LADDER_RANK: readonly LadderPriority[] = [
  "error",
  "pending-approval",
  "awaiting-input",
  "working",
  "plan-ready",
  "completed-unseen",
  "idle",
];

/** The tiers that want a human right now — the "needs you" set the spine's header banner counts and
 *  the OS-notification bell fires on. The daemon folds land-blocked (veto / closed-PR) into `error`
 *  and gate-vs-question into `pending-approval` / `awaiting-input`, so this is exactly the old
 *  `rankUnit ≤ 2` attention set, now server-defined. `plan-ready` is staged-but-not-blocking, so it
 *  is deliberately NOT in this set (matching the old ceiling). */
const ATTENTION_TIERS: ReadonlySet<LadderPriority> = new Set<LadderPriority>([
  "error",
  "pending-approval",
  "awaiting-input",
]);

const IDLE_RANK = LADDER_RANK.length - 1;

/** Index of a tier in `LADDER_RANK` (LOWER = more urgent). An absent tier (an old daemon that
 *  predates concern 06, or an untrusted/unknown wire value) sorts as `idle` — the conservative
 *  "nothing to escalate" floor, never spuriously floated to the top. */
export function ladderRank(priority: LadderPriority | undefined): number {
  if (priority === undefined) return IDLE_RANK;
  const i = LADDER_RANK.indexOf(priority);
  return i === -1 ? IDLE_RANK : i;
}

/** The most-urgent tier among a group's units — the spine's per-project/per-daemon roll-up. A
 *  faithful mirror of the daemon's `maxLadderPriority`; an empty group reads as `idle` (nothing to
 *  escalate), never a thrown/undefined a header renderer would have to special-case. */
export function maxLadderPriority(
  priorities: (LadderPriority | undefined)[],
): LadderPriority {
  let best: LadderPriority = "idle";
  let bestRank = IDLE_RANK;
  for (const p of priorities) {
    const r = ladderRank(p);
    if (r < bestRank) {
      bestRank = r;
      best = p ?? "idle";
    }
  }
  return best;
}

/** True when a unit's SERVER tier is in the attention set (error / pending-approval / awaiting-input)
 *  — the cockpit never decides "needs a human" from raw status anymore, only from the daemon's rung. */
export function needsHuman(u: Pick<FleetUnit, "ladderPriority">): boolean {
  return u.ladderPriority !== undefined && ATTENTION_TIERS.has(u.ladderPriority);
}

/** The t3 status grammar for a tier: a token-resolved dot class (so it repaints under any theme —
 *  raw palette colors are deliberately NOT hardcoded here, concern 01/02), a compact label, and
 *  `pulse` ONLY on the in-flight `working` tier (concern 07's motion rule). `awaiting-input` and
 *  `working` deliberately share the `info` token (t3's indigo-vs-sky raw-palette split collapses to
 *  one token here); the pulse is what distinguishes an actively-streaming unit from a blocked one. */
export interface LadderMeta {
  /** A `bg-*` token utility class for the status dot. */
  dot: string;
  /** Compact status word for the `text-[10px]` pill label. */
  label: string;
  /** Duty-cycled `animate-status-pulse` — only the in-flight `working` tier. */
  pulse?: boolean;
}

const LADDER_META: Record<LadderPriority, LadderMeta> = {
  error: { dot: "bg-destructive", label: "error" },
  "pending-approval": { dot: "bg-warning", label: "approve" },
  "awaiting-input": { dot: "bg-info", label: "input" },
  working: { dot: "bg-info", label: "working", pulse: true },
  "plan-ready": { dot: "bg-pending", label: "ready" },
  "completed-unseen": { dot: "bg-success", label: "done" },
  idle: { dot: "bg-muted-foreground/60", label: "idle" },
};

/** Presentation meta for a tier — falls back to `idle` for an absent/unknown wire value. */
export function ladderMeta(priority: LadderPriority | undefined): LadderMeta {
  return (priority && LADDER_META[priority]) ?? LADDER_META.idle;
}

/** A one-line reason for a unit's rung — the pill tooltip / notification body. Descriptive text
 *  formatted from the unit's own fields (pending title, error text, held verdict); it is NOT a
 *  ranking. The daemon owns the tier; the cockpit only phrases WHY that tier fired. Returns "" for
 *  tiers with no useful detail (working / idle), so the pill tooltip falls back to the bare label. */
export function ladderReason(u: FleetUnit): string {
  switch (u.ladderPriority) {
    case "error": {
      if (u.error) return u.error;
      const v = u.validation?.verdict;
      if (u.landReady && v !== undefined && v !== "approve")
        return `land-ready but held: validator ${v}`;
      if (u.prState === "closed") return "PR closed without merging";
      return "agent error";
    }
    case "pending-approval":
    case "awaiting-input":
      return u.pending?.[0]?.title ?? "waiting for your input";
    case "plan-ready":
      return "land-ready";
    case "completed-unseen":
      return "completed — unseen";
    default:
      return "";
  }
}

/** OS-notification title for a unit that just entered the attention set (the bell, C08). Error-tier
 *  units read "errored"; everything else in the set reads "needs you". */
export function ladderAlertTitle(u: FleetUnit): string {
  return u.ladderPriority === "error"
    ? `⚠ ${u.name} errored`
    : `⛔ ${u.name} needs you`;
}
