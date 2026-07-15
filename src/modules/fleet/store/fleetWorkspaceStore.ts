import { create } from "zustand";
import { type FleetLease, normalizeLeases } from "../lib/fleetWorkspace";
import { getDaemonUrl } from "../lib/fleetConfig";
import { getFleetToken } from "../lib/fleetKeyring";
import { FleetClient, normalizeBaseUrl } from "../lib/fleetClient";

// Polls GET /api/leases for the selected unit's repo (leases change slower than the roster, so 3s).
// Poll-only because the fork CSP blocks ws:// and leases are never on the daemon's WS event union.
// Keyed by repo so switching units re-targets; keeps the last good leases on a failed poll.

const POLL_MS = 3000;

type FleetWorkspaceState = {
  repo: string | null;
  leases: FleetLease[];
  start: (repo: string) => void;
  stop: () => void;
};

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: AbortController | null = null;
let currentRepo: string | null = null;

async function pollOnce(
  repo: string,
  set: (p: Partial<FleetWorkspaceState>) => void,
): Promise<void> {
  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;
  try {
    const client = new FleetClient({
      baseUrl: normalizeBaseUrl(await getDaemonUrl()),
      token: await getFleetToken(),
    });
    const raw = await client.leases(repo, ctrl.signal);
    if (ctrl.signal.aborted || currentRepo !== repo) return;
    set({ leases: normalizeLeases(raw) });
  } catch {
    // Keep the last good leases on a transient failure — the overlay just goes stale, not empty.
  }
}

export const useFleetWorkspace = create<FleetWorkspaceState>((set) => ({
  repo: null,
  leases: [],

  start: (repo: string) => {
    // A different unit selected → retarget: clear the old leases, poll the new repo.
    if (currentRepo === repo && timer) return;
    if (timer) clearInterval(timer);
    inFlight?.abort();
    currentRepo = repo;
    set({ repo, leases: [] });
    void pollOnce(repo, set);
    timer = setInterval(() => void pollOnce(repo, set), POLL_MS);
  },

  stop: () => {
    if (timer) clearInterval(timer);
    timer = null;
    inFlight?.abort();
    inFlight = null;
    currentRepo = null;
    set({ repo: null, leases: [] });
  },
}));
