// One implementation of "start a console thread on the active daemon" (C13-F4), shared by the
// spine's New-thread verb and the hub hero's first-send (r3 — plans/research-t3code round 3).
// Create the console unit, optionally steer its first turn, refresh the roster BEFORE selecting
// (FleetLayout's vanished-unit cleanup would instantly deselect a key the roster can't find yet),
// then select it so IntervenePane opens on the new thread.

import type { FleetClient } from "./fleetClient";

export type StartThreadResult =
  | { ok: true; unitId: string }
  | { ok: false; reason: string };

export async function startConsoleThread(deps: {
  client: (daemonId: string) => Promise<FleetClient>;
  activeId: string;
  refresh: () => Promise<void>;
  select: (key: string | null) => void;
  /** When present, sent as the thread's first turn before selection — the hero's type-to-start. */
  firstMessage?: string;
}): Promise<StartThreadResult> {
  const { activeId, firstMessage } = deps;
  try {
    const c = await deps.client(activeId);
    const unitId = await c.createConsole();
    if (!unitId) {
      return { ok: false, reason: "Couldn't start a new thread on this daemon." };
    }
    if (firstMessage) {
      // clientTurnId keeps the turn reconcile-able if a composer later shows it optimistically.
      const res = await c.steer(unitId, firstMessage, crypto.randomUUID());
      if (!res.ok) {
        // The thread EXISTS — surface it anyway so the typed message isn't stranded nowhere.
        await deps.refresh();
        deps.select(`${activeId}:${unitId}`);
        return { ok: false, reason: res.detail ?? "The thread started but the first send failed." };
      }
    }
    await deps.refresh();
    deps.select(`${activeId}:${unitId}`);
    return { ok: true, unitId };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't start a new thread.",
    };
  }
}
