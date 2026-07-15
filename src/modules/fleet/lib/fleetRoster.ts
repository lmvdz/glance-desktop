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

/** Defensive: keep only well-formed units from an untrusted roster payload. */
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
