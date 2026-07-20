// One implementation of "start a console thread on the active daemon" (C13-F4), shared by the
// spine's New-thread verb and the hub hero's first-send (r3 — plans/research-t3code round 3).
// Create the console unit, optionally steer its first turn, refresh the roster BEFORE selecting
// (FleetLayout's vanished-unit cleanup would instantly deselect a key the roster can't find yet),
// then select it so IntervenePane opens on the new thread.

import type { FleetClient } from "./fleetClient";

export type StartThreadResult =
  | { ok: true; unitId: string }
  | { ok: false; reason: string; unitId?: string };

/** One create per daemon at a time — HubHero and the spine's New-thread verb are mounted
 *  simultaneously with independent busy guards, so the lock must live here, shared. */
const inFlightDaemons = new Set<string>();

/** How many refresh attempts to give the roster before selecting anyway — selecting a key the
 *  (non-empty) roster doesn't hold yet trips FleetLayout's vanished-unit cleanup, which would
 *  instantly deselect the brand-new thread. */
const ROSTER_SETTLE_ATTEMPTS = 3;
const ROSTER_SETTLE_DELAY_MS = 400;

export async function startConsoleThread(deps: {
  client: (daemonId: string) => Promise<FleetClient>;
  activeId: string;
  refresh: () => Promise<void>;
  select: (key: string | null) => void;
  /** True when the roster currently holds this `daemonId:id` key — see ROSTER_SETTLE_ATTEMPTS. */
  hasUnit: (key: string) => boolean;
  /** When present, sent as the thread's first turn before selection — the hero's type-to-start. */
  firstMessage?: string;
}): Promise<StartThreadResult> {
  const { activeId, firstMessage } = deps;
  if (inFlightDaemons.has(activeId)) {
    return { ok: false, reason: "A new thread is already being created on this daemon." };
  }
  inFlightDaemons.add(activeId);
  let createdUnitId: string | undefined;
  try {
    const c = await deps.client(activeId);
    const unitId = await c.createConsole();
    if (!unitId) {
      return { ok: false, reason: "Couldn't start a new thread on this daemon." };
    }
    createdUnitId = unitId;
    if (firstMessage) {
      // clientTurnId keeps the turn reconcile-able if a composer later shows it optimistically.
      const res = await c.steer(unitId, firstMessage, crypto.randomUUID());
      if (!res.ok) {
        // The thread EXISTS but the send didn't land. Do NOT select here: the caller must first
        // re-home the typed message (e.g. into the unit's steer draft) — selecting now would
        // unmount the caller with the text stranded under its own key and the error unseen.
        return {
          ok: false,
          unitId,
          reason: res.detail ?? "The thread started but the first send failed.",
        };
      }
    }
    // Wait for the roster to actually hold the new unit before selecting (bounded — a daemon
    // whose roster poll keeps failing still gets a best-effort select at the end).
    const key = `${activeId}:${unitId}`;
    for (let attempt = 0; attempt < ROSTER_SETTLE_ATTEMPTS; attempt += 1) {
      await deps.refresh();
      if (deps.hasUnit(key)) break;
      if (attempt < ROSTER_SETTLE_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, ROSTER_SETTLE_DELAY_MS));
      }
    }
    deps.select(key);
    return { ok: true, unitId };
  } catch (e) {
    return {
      ok: false,
      // A throw AFTER creation still reports the unit — the caller must not treat "retry" as
      // "create another one", and can hand the typed message to the existing thread.
      unitId: createdUnitId,
      reason: e instanceof Error ? e.message : "Couldn't start a new thread.",
    };
  } finally {
    inFlightDaemons.delete(activeId);
  }
}
