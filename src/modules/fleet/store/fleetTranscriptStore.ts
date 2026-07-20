import { create } from "zustand";
import { unitKey } from "../lib/fleetRoster";
import {
  type TranscriptEntry,
  mergeTranscript,
  normalizeTranscript,
  reconcileOptimistic,
  runningFloor,
} from "../lib/fleetTranscript";
import { getPrewarmedTranscript } from "../spine/lib/transcriptPrewarm";
import { useFleetConnection } from "./fleetConnectionStore";

// The live ACP conversation for the selected unit (I03). Polls the transcript DELTA (I01's
// ?since=seq) every ~1.5s and merges it into the accumulated conversation — full fetch once,
// then only new turns. Poll-only (CSP blocks ws://); keeps the conversation on a failed poll.
// A sent prompt is appended OPTIMISTICALLY and reconciled away when the server echoes it back.
//
// M02: a unit's transcript lives on ITS daemon, not necessarily the active one, so `start` takes
// the daemon id alongside the unit id and builds its client from `useFleetConnection`'s
// per-daemon lookup instead of the old single-daemon `getDaemonUrl`/`getFleetToken` back-compat.
//
// t3-face C04: the cursor is `runningFloor`, not `maxSeq` — the daemon mutates a streaming entry
// (assistant text growing, a tool going running→done) IN PLACE without bumping `seq`, so a cursor
// that has already passed that entry's seq would never see the daemon settle it. Holding the
// floor one below the lowest still-running entry keeps re-requesting it (and everything after)
// until it settles; see fleetTranscript.ts for the full mechanism.

const POLL_MS = 1500;

type FleetTranscriptState = {
  unitId: string | null;
  daemonId: string | null;
  entries: TranscriptEntry[];
  /** False until the first poll for the current unit resolves (or it was seeded from prewarm) — lets
   *  the pane show a loading skeleton on a cold open and distinguish "still fetching" from a unit
   *  that genuinely has no conversation yet (t3-face concern 11). */
  loaded: boolean;
  start: (unitId: string, daemonId: string) => void;
  stop: () => void;
  /** Optimistically show the user's just-sent turn; the poll reconciles it against the server echo. */
  addOptimistic: (text: string, clientTurnId: string) => void;
};

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: AbortController | null = null;
let currentUnit: string | null = null;
let currentDaemon: string | null = null;

async function pollOnce(
  unitId: string,
  daemonId: string,
  get: () => FleetTranscriptState,
  set: (p: Partial<FleetTranscriptState>) => void,
): Promise<void> {
  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;
  try {
    const client = await useFleetConnection.getState().client(daemonId);
    const since = runningFloor(get().entries);
    const raw = await client.transcript(
      unitId,
      since > 0 ? since : undefined,
      ctrl.signal,
    );
    if (
      ctrl.signal.aborted ||
      currentUnit !== unitId ||
      currentDaemon !== daemonId
    )
      return;
    const delta = normalizeTranscript(raw);
    // Mark loaded the first time a poll resolves for this unit — even with an empty delta, so a unit
    // that genuinely has no conversation drops out of the loading skeleton into the empty state.
    const patch: Partial<FleetTranscriptState> = {};
    if (!get().loaded) patch.loaded = true;
    if (delta.length > 0)
      patch.entries = reconcileOptimistic(mergeTranscript(get().entries, delta));
    if (patch.loaded !== undefined || patch.entries !== undefined) set(patch);
  } catch {
    // Keep the conversation on a transient failure — it just stops growing until the next poll. A
    // failed FIRST poll still leaves the skeleton; the next poll (1.5s) clears it once it resolves.
  }
}

export const useFleetTranscript = create<FleetTranscriptState>((set, get) => ({
  unitId: null,
  daemonId: null,
  entries: [],
  loaded: false,

  start: (unitId: string, daemonId: string) => {
    if (currentUnit === unitId && currentDaemon === daemonId && timer) return;
    if (timer) clearInterval(timer);
    inFlight?.abort();
    currentUnit = unitId;
    currentDaemon = daemonId;
    // t3-face C05: seed from the spine's prewarm cache when this unit was warmed ahead of the
    // click (ThreadSpine's top-N prewarm) — paints the pane instantly instead of blanking it
    // while the first poll is in flight. `since` below is still derived from the seed's own
    // runningFloor, so the first poll only fetches what's changed since the prewarm snapshot; a
    // cold (unwarmed) unit falls back to `[]` exactly as before.
    const seed = getPrewarmedTranscript(unitKey({ daemonId, id: unitId })) ?? [];
    // A prewarmed seed is already a real fetch result — treat it as loaded so a warm open never
    // flashes a skeleton over content it already has; a cold ([]) open shows the skeleton until the
    // first poll resolves below.
    set({ unitId, daemonId, entries: seed, loaded: seed.length > 0 });
    void pollOnce(unitId, daemonId, get, set);
    timer = setInterval(
      () => void pollOnce(unitId, daemonId, get, set),
      POLL_MS,
    );
  },

  stop: () => {
    if (timer) clearInterval(timer);
    timer = null;
    inFlight?.abort();
    inFlight = null;
    currentUnit = null;
    currentDaemon = null;
    set({ unitId: null, daemonId: null, entries: [], loaded: false });
  },

  addOptimistic: (text: string, clientTurnId: string) => {
    const optimistic: TranscriptEntry = {
      kind: "user",
      text,
      ts: Date.now(),
      clientTurnId,
    };
    set({ entries: [...get().entries, optimistic] });
  },
}));
