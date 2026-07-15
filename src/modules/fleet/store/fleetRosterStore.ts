import { create } from "zustand";
import { FleetAuthError } from "../lib/fleetClient";
import { type FleetUnit, normalizeRoster } from "../lib/fleetRoster";
import { getFleetToken } from "../lib/fleetKeyring";
import { getDaemonUrl } from "../lib/fleetConfig";
import { FleetClient, normalizeBaseUrl } from "../lib/fleetClient";

// Roster transport is POLLING GET /api/agents, deliberately: the daemon's push channel is a
// WebSocket at /ws, and the cockpit's CSP `connect-src` allows http://127.0.0.1:* but NOT ws://.
// Widening the CSP exfil control to permit ws is a separate, deliberate security decision (or a
// daemon-side SSE endpoint) — tracked as a follow-up, not smuggled into the roster PR. The poll
// lives behind this one store method, so swapping to push later is a localized change.

const POLL_MS = 2000;

export type RosterConnection =
  | "connecting"
  | "live"
  | "reconnecting"
  | "unauthorized";

type FleetRosterState = {
  units: FleetUnit[];
  connection: RosterConnection;
  lastUpdated: number | null;
  /** Consecutive poll failures — drives the visible "reconnecting" degrade. */
  failures: number;
  start: () => void;
  stop: () => void;
};

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: AbortController | null = null;
let subscribers = 0;

async function pollOnce(
  set: (p: Partial<FleetRosterState>) => void,
  get: () => FleetRosterState,
): Promise<void> {
  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;
  try {
    const client = new FleetClient({
      baseUrl: normalizeBaseUrl(await getDaemonUrl()),
      token: await getFleetToken(),
    });
    const raw = await client.roster(ctrl.signal);
    if (ctrl.signal.aborted) return;
    set({
      units: normalizeRoster(raw),
      connection: "live",
      lastUpdated: Date.now(),
      failures: 0,
    });
  } catch (err) {
    if (ctrl.signal.aborted) return;
    if (err instanceof FleetAuthError) {
      set({ connection: "unauthorized" });
      return;
    }
    // Keep the last good roster on screen; just mark it stale and reconnecting.
    set({ connection: "reconnecting", failures: get().failures + 1 });
  }
}

export const useFleetRoster = create<FleetRosterState>((set, get) => ({
  units: [],
  connection: "connecting",
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
