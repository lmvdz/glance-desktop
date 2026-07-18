// Shell-mode boot decision (hub-shell concern H0). Replaces planCockpitBoot.
//
// The app now renders two stacked shells — the t3code thread client ("hub") and
// terax's IDE ("workspace") — and boots into one of them. DIRECTION.md: the hub
// is the DEFAULT shell; the IDE is the substrate, opened on demand. This is the
// pure decision; App.tsx applies it by calling `useShellMode.setMode(...)`.
//
// Kept free of React and store access so it's exhaustively unit-testable across
// the launch-target × persisted-mode × open-on-launch matrix.

import type { ShellMode } from "./shellModeStore";

export type ShellBootInputs = {
  /** App was launched on an explicit dir/file target (CLI arg / "Open With"). */
  hasExplicitLaunchTarget: boolean;
  /** The user's persisted shell choice, or null if they've never chosen one. */
  persistedMode: ShellMode | null;
  /**
   * The "Open fleet on launch" preference (default on). Only consulted on a
   * genuine first launch (no persisted mode) — it picks the first-run default
   * without overriding where a returning user last was.
   */
  openFleetOnLaunch: boolean;
};

/**
 * Decide which shell the app should boot into. Precedence, highest first:
 *
 *  1. An explicit launch target (`glance <path>` / "Open With") → workspace.
 *     The user pointed the app at a file/folder, so the editor entry stays
 *     first-class and is never shoved behind the hub.
 *  2. A persisted mode → restore it. A returning user lands back in whichever
 *     shell they last used; their most recent explicit position wins over the
 *     static first-run toggle below.
 *  3. First launch (no persisted mode) → the hub by default, unless the user
 *     turned "Open fleet on launch" off, in which case they prefer the IDE as
 *     home and boot into workspace.
 *
 * Note: a configured daemon connection is deliberately NOT a gate here. Under
 * DIRECTION.md the thread client is the whole app even before a daemon is set
 * up (the hub renders its own "not connected" recovery card) — the behavioral
 * change from the old cockpit-first boot, which only surfaced the fleet when a
 * connection existed.
 */
export function planShellBoot(inputs: ShellBootInputs): ShellMode {
  if (inputs.hasExplicitLaunchTarget) return "workspace";
  if (inputs.persistedMode !== null) return inputs.persistedMode;
  return inputs.openFleetOnLaunch ? "hub" : "workspace";
}
