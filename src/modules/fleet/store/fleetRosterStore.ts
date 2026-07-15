import { create } from "zustand";
import { attentionTransitions } from "../lib/fleetAttention";
import { notifyAttention } from "../lib/fleetBell";
import {
  FleetAuthError,
  FleetClient,
  normalizeBaseUrl,
} from "../lib/fleetClient";
import { type DaemonConnection, getConnections } from "../lib/fleetConfig";
import { getDaemonToken } from "../lib/fleetKeyring";
import {
  type DaemonRosterStatus,
  type FleetUnit,
  aggregateConnection,
  mergeRosters,
  normalizeRoster,
  sortUnits,
  tagUnits,
} from "../lib/fleetRoster";

// Roster transport is POLLING GET /api/agents, deliberately: the daemon's push channel is a
// WebSocket at /ws, and the cockpit's CSP `connect-src` allows http://127.0.0.1:* but NOT ws://.
// Widening the CSP exfil control to permit ws is a separate, deliberate security decision (or a
// daemon-side SSE endpoint) — tracked as a follow-up, not smuggled into the roster PR. The poll
// lives behind this one store method, so swapping to push later is a localized change.
//
// M02: one poll cycle now fans out to EVERY connected daemon (M01's `getConnections()`), each
// with its own client + its own keyring token, and merges the results into one attention-ranked
// roster (fleetRoster's `tagUnits`/`mergeRosters`). A daemon that fails degrades ONLY its own
// rows — the last roster it reported stays on screen, just marked reconnecting/unauthorized —
// while the other daemons keep updating normally.

const POLL_MS = 2000;

/** Back-compat alias: this used to be the ONE daemon's status; it's now the aggregate across all
 *  of them (see `daemonStatuses` for the per-daemon breakdown). */
export type RosterConnection = DaemonRosterStatus;

type FleetRosterState = {
  units: FleetUnit[];
  connection: RosterConnection;
  /** Per-daemon connection state, keyed by connection id (M02) — what a single-daemon poll cycle
   *  failure used to mean for `connection` as a whole now applies to just that daemon's entry. */
  daemonStatuses: Record<string, RosterConnection>;
  lastUpdated: number | null;
  /** Consecutive poll CYCLES where every configured daemon failed — drives the visible
   *  "reconnecting" degrade even though individual daemons may recover independently. */
  failures: number;
  start: () => void;
  stop: () => void;
};

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: AbortController | null = null;
let subscribers = 0;
// Unit ids currently in a notified attention state, keyed by `daemonId:unitId` (fleetRoster's
// unitKey) — module-level, one per app. Daemon-scoped so the same unit id on two daemons is
// tracked independently (M02).
let notifiedAttention: Set<string> = new Set();
// Last known-good tagged units per daemon id. A daemon's poll failure keeps ITS rows on screen
// (only that daemon's status flips to reconnecting/unauthorized) instead of blanking the whole
// merged roster just because one host went away.
const lastUnitsByDaemon = new Map<string, FleetUnit[]>();

type DaemonPollResult = {
  connId: string;
  status: DaemonRosterStatus;
  units: FleetUnit[];
};

async function pollDaemon(
  conn: DaemonConnection,
  signal: AbortSignal,
): Promise<DaemonPollResult> {
  try {
    const client = new FleetClient({
      baseUrl: normalizeBaseUrl(conn.baseUrl),
      token: await getDaemonToken(conn.id),
    });
    const raw = await client.roster(signal);
    const units = tagUnits(normalizeRoster(raw), conn.id, conn.label);
    return { connId: conn.id, status: "live", units };
  } catch (err) {
    const status: DaemonRosterStatus =
      err instanceof FleetAuthError ? "unauthorized" : "reconnecting";
    // Degrade only this daemon: keep whatever it last reported successfully.
    return {
      connId: conn.id,
      status,
      units: lastUnitsByDaemon.get(conn.id) ?? [],
    };
  }
}

async function pollOnce(
  set: (p: Partial<FleetRosterState>) => void,
  get: () => FleetRosterState,
): Promise<void> {
  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;

  const connections = await getConnections();
  if (ctrl.signal.aborted) return;

  if (connections.length === 0) {
    lastUnitsByDaemon.clear();
    set({
      units: [],
      connection: "connecting",
      daemonStatuses: {},
      lastUpdated: Date.now(),
    });
    return;
  }

  const results = await Promise.all(
    connections.map((conn) => pollDaemon(conn, ctrl.signal)),
  );
  if (ctrl.signal.aborted) return;

  // Refresh the per-daemon cache with this cycle's live fetches; forget daemons that were removed.
  const activeIds = new Set(connections.map((c) => c.id));
  for (const id of lastUnitsByDaemon.keys())
    if (!activeIds.has(id)) lastUnitsByDaemon.delete(id);
  for (const r of results)
    if (r.status === "live") lastUnitsByDaemon.set(r.connId, r.units);

  const nextUnits = sortUnits(mergeRosters(results.map((r) => r.units)));
  const daemonStatuses = Object.fromEntries(
    results.map((r) => [r.connId, r.status] as const),
  );
  const connection = aggregateConnection(daemonStatuses);

  // Fire a native OS notification for each unit that JUST started needing a human (C08), scoped
  // per daemon (M02) so the collapse set never conflates two daemons' same-id units.
  const { alerts, notified } = attentionTransitions(
    get().units,
    nextUnits,
    notifiedAttention,
  );
  notifiedAttention = notified;
  for (const a of alerts) void notifyAttention(a);

  set({
    units: nextUnits,
    connection,
    daemonStatuses,
    lastUpdated: Date.now(),
    failures: connection === "live" ? 0 : get().failures + 1,
  });
}

export const useFleetRoster = create<FleetRosterState>((set, get) => ({
  units: [],
  connection: "connecting",
  daemonStatuses: {},
  lastUpdated: null,
  failures: 0,

  start: () => {
    subscribers += 1;
    if (timer) return; // already polling for another mounted pane
    void pollOnce(set, get);
    timer = setInterval(() => void pollOnce(set, get), POLL_MS);
  },

  stop: () => {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers > 0) return; // another pane is still watching
    if (timer) clearInterval(timer);
    timer = null;
    inFlight?.abort();
    inFlight = null;
  },
}));
