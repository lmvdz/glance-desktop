// Roster types + pure derivations for the fleet panes (fleet-ide-cockpit C05). A trimmed,
// fork-local mirror of the daemon's AgentDTO — only the fields the cockpit renders. Kept
// pure and separate from the poller so the ordering/attention rules are unit-testable.

export type FleetStatus =
  | "starting"
  | "working"
  | "idle"
  | "input"
  | "error"
  | "stopped";

export interface FleetPending {
  id: string;
  title: string;
}

export interface FleetReceipt {
  costUsd?: number;
  tokens?: number;
}

/** The slice of the daemon's AgentDTO the cockpit shows. Extra fields on the wire are ignored. */
export interface FleetUnit {
  id: string;
  name: string;
  status: FleetStatus;
  repo: string;
  repoName?: string;
  /** Which daemon connection (M01) this unit was fetched from (M02). Stamped by the poller, never
   *  sent by the daemon — unit ids are only unique WITHIN a daemon, so every merged-roster key and
   *  every per-unit action must disambiguate with this, not `id` alone. */
  daemonId: string;
  /** The connection's display label at fetch time, for host badges — a copy, not a live join, so a
   *  renamed connection doesn't retroactively relabel units already in the roster snapshot. */
  daemonLabel?: string;
  /** Absolute path of the unit's git worktree — the target of the "open worktree" gesture (C06). */
  worktree?: string;
  branch?: string;
  harness?: string;
  /** Requested autonomy mode (observe/assist/autodrive) — captured before "Take over" so
   *  "Hand back" can restore it (I05). */
  autonomyMode?: string;
  startedAt?: number;
  contextPct?: number;
  receipt?: FleetReceipt;
  pending?: FleetPending[];
  landReady?: boolean;
  /** Validator verdict — a `veto` (or an unresolved judge) on a land-ready unit wants review. */
  validation?: { verdict?: "approve" | "veto" | "abstain" | "unknown" };
  error?: string;
}

/** True when a land-ready unit is held by the validator (vetoed or the judge couldn't say). */
export function isValidatorHeld(u: FleetUnit): boolean {
  const v = u.validation?.verdict;
  return u.landReady === true && v !== undefined && v !== "approve";
}

/**
 * Attention rank — LOWER floats higher. Mirrors the daemon TUI's `agentRank` exactly so the
 * cockpit and the terminal agree on "what needs a human first": blocked-on-input, then errored,
 * then land-ready-but-held (review), then land-ready, then the rest by liveness.
 */
export function rankUnit(u: FleetUnit): number {
  if (u.status === "input") return 0;
  if (u.status === "error") return 1;
  if (u.landReady && isValidatorHeld(u)) return 2;
  if (u.landReady) return 3;
  const rest: Record<FleetStatus, number> = {
    working: 4,
    idle: 5,
    starting: 6,
    stopped: 7,
    input: 0,
    error: 1,
  };
  return rest[u.status] ?? 5;
}

/** Stable roster order: by attention rank, then name (so equal-rank rows don't jitter). */
export function sortUnits(units: FleetUnit[]): FleetUnit[] {
  return [...units].sort(
    (a, b) => rankUnit(a) - rankUnit(b) || a.name.localeCompare(b.name),
  );
}

/** The units that want a human right now: blocked-on-input, errored, or land-ready-but-held. */
export function attentionUnits(units: FleetUnit[]): FleetUnit[] {
  return sortUnits(units.filter((u) => rankUnit(u) <= 2));
}

/** One-line reason a unit is in the attention queue — the same wording the push/OSC lanes use. */
export function attentionReason(u: FleetUnit): string {
  if (u.status === "input")
    return u.pending?.[0]?.title ?? "waiting for your input";
  if (u.status === "error") return u.error ?? "agent error";
  if (u.landReady && isValidatorHeld(u))
    return `land-ready but held: validator ${u.validation?.verdict ?? "unresolved"}`;
  return "";
}

/** Defensive: keep only well-formed units from an untrusted roster payload. `daemonId` is NOT
 *  validated here — the wire payload never carries one; `tagUnits` stamps it after this filter. */
export function normalizeRoster(payload: unknown): FleetUnit[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (u): u is FleetUnit =>
      !!u &&
      typeof u === "object" &&
      typeof (u as FleetUnit).id === "string" &&
      typeof (u as FleetUnit).name === "string" &&
      typeof (u as FleetUnit).status === "string",
  );
}

// ---------------------------------------------------------------------------------------
// Cross-daemon merge (M02) — a unit's `id` is only unique WITHIN its own daemon, so a merged
// roster (or any set/map keyed off a unit) must key by `daemonId:id` instead.
// ---------------------------------------------------------------------------------------

/** Stamp every unit from one daemon's fetch with that daemon's id (+ label for host badges). */
export function tagUnits(
  units: FleetUnit[],
  daemonId: string,
  daemonLabel?: string,
): FleetUnit[] {
  return units.map((u) => ({ ...u, daemonId, daemonLabel }));
}

/** The disambiguating key for a unit in a merged, multi-daemon roster. */
export function unitKey(u: Pick<FleetUnit, "daemonId" | "id">): string {
  return `${u.daemonId}:${u.id}`;
}

/** Merge already-tagged per-daemon unit lists into one roster, deduping by `unitKey` (last write
 *  wins — later lists override earlier ones for the same key, so a caller can re-merge a single
 *  daemon's fresh fetch over a stale combined list without producing duplicate rows). */
export function mergeRosters(perDaemon: FleetUnit[][]): FleetUnit[] {
  const byKey = new Map<string, FleetUnit>();
  for (const units of perDaemon) {
    for (const u of units) byKey.set(unitKey(u), u);
  }
  return [...byKey.values()];
}

/** Per-daemon connection health, as tracked by the roster poller (M02). Mirrors what
 *  `RosterConnection` used to mean back when there was only ever one daemon to poll. */
export type DaemonRosterStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "unauthorized";

/**
 * Roll per-daemon statuses up into one headline connection state for the pane: "live" the moment
 * ANY daemon has fresh data (there's something real on screen), otherwise "connecting" while any
 * daemon is still on its first probe, otherwise "unauthorized" only if EVERY daemon is refusing
 * the token, and "reconnecting" for every other degraded mix. No configured daemons reads as
 * "connecting" (nothing to show yet, not an error).
 */
export function aggregateConnection(
  statuses: Record<string, DaemonRosterStatus>,
): DaemonRosterStatus {
  const values = Object.values(statuses);
  if (values.length === 0) return "connecting";
  if (values.some((s) => s === "live")) return "live";
  if (values.some((s) => s === "connecting")) return "connecting";
  if (values.every((s) => s === "unauthorized")) return "unauthorized";
  return "reconnecting";
}
