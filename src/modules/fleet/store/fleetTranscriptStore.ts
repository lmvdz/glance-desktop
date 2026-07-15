import { create } from "zustand";
import {
  type TranscriptEntry,
  maxSeq,
  mergeTranscript,
  normalizeTranscript,
  reconcileOptimistic,
} from "../lib/fleetTranscript";
import { useFleetConnection } from "./fleetConnectionStore";

// The live ACP conversation for the selected unit (I03). Polls the transcript DELTA (I01's
// ?since=seq) every ~1.5s and merges it into the accumulated conversation — full fetch once,
// then only new turns. Poll-only (CSP blocks ws://); keeps the conversation on a failed poll.
// A sent prompt is appended OPTIMISTICALLY and reconciled away when the server echoes it back.
//
// M02: a unit's transcript lives on ITS daemon, not necessarily the active one, so `start` takes
// the daemon id alongside the unit id and builds its client from `useFleetConnection`'s
// per-daemon lookup instead of the old single-daemon `getDaemonUrl`/`getFleetToken` back-compat.

const POLL_MS = 1500;

type FleetTranscriptState = {
  unitId: string | null;
  daemonId: string | null;
  entries: TranscriptEntry[];
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
    const since = maxSeq(get().entries);
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
    if (delta.length === 0) return; // nothing new
    set({
      entries: reconcileOptimistic(mergeTranscript(get().entries, delta)),
    });
  } catch {
    // Keep the conversation on a transient failure — it just stops growing until the next poll.
  }
}

export const useFleetTranscript = create<FleetTranscriptState>((set, get) => ({
  unitId: null,
  daemonId: null,
  entries: [],

  start: (unitId: string, daemonId: string) => {
    if (currentUnit === unitId && currentDaemon === daemonId && timer) return;
    if (timer) clearInterval(timer);
    inFlight?.abort();
    currentUnit = unitId;
    currentDaemon = daemonId;
    set({ unitId, daemonId, entries: [] }); // fresh unit → full re-fetch (since=0)
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
    set({ unitId: null, daemonId: null, entries: [] });
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
