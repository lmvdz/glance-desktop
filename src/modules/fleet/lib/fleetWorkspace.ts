// Lease + presence overlay helpers (fleet-ide-intervention I04): who holds which file in a unit's
// worktree, so a human intervening in a shared tree sees what the agent (and any other session) is
// touching. Pure + separate from the poller so the stale-filter and holder-grouping are testable.

/** A held-file lease — the daemon's LeaseEntry (GET /api/leases). */
export interface FleetLease {
  id: string;
  repo: string;
  /** Repo-relative path. */
  file: string;
  operator: string;
  /** Holder session label — an agent (`omp:…`/`squad:…`) or the human (`glance-cockpit:…`). */
  session: string;
  host: string;
  since: number;
  heartbeat: number;
}

/** The daemon's lease TTL (src/leases.ts LEASE_TTL_MS) — an entry not heartbeated within it is dead. */
export const LEASE_TTL_MS = 120_000;

export function normalizeLeases(payload: unknown): FleetLease[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (l): l is FleetLease =>
      !!l &&
      typeof l === "object" &&
      typeof (l as FleetLease).file === "string" &&
      typeof (l as FleetLease).session === "string" &&
      typeof (l as FleetLease).heartbeat === "number",
  );
}

/** Drop leases whose last heartbeat is older than the TTL — the daemon's own liveness rule, applied
 *  client-side so a stale poll snapshot never shows a lock that has already lapsed. */
export function liveLeases(
  leases: FleetLease[],
  now: number,
  ttlMs = LEASE_TTL_MS,
): FleetLease[] {
  return leases.filter((l) => now - l.heartbeat < ttlMs);
}

/** True when a holder is the human at a cockpit (vs a daemon agent) — styled distinctly in the overlay
 *  so an intervening human sees "this is MY hold" apart from "the agent is holding this". */
export function isHumanHolder(session: string): boolean {
  return /^glance-cockpit:/i.test(session);
}

export interface HolderGroup {
  session: string;
  human: boolean;
  files: string[];
}

/** Group live leases by holder session, human holders first, files sorted — the overlay's rows. */
export function groupByHolder(leases: FleetLease[]): HolderGroup[] {
  const bySession = new Map<string, string[]>();
  for (const l of leases) {
    const files = bySession.get(l.session) ?? [];
    files.push(l.file);
    bySession.set(l.session, files);
  }
  return [...bySession.entries()]
    .map(([session, files]) => ({
      session,
      human: isHumanHolder(session),
      files: [...new Set(files)].sort(),
    }))
    .sort((a, b) =>
      a.human === b.human
        ? a.session.localeCompare(b.session)
        : a.human
          ? -1
          : 1,
    );
}
