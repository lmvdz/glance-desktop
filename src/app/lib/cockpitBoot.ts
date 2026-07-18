// Cockpit-first launch decision (t3-face C13-F2). Lars launched the app expecting
// t3code's layout ("where are the threads?") and got the terax editor shell — the
// fleet spine only showed inside a manually-opened tab. On boot, if a fleet daemon
// connection is configured, we want to land in the cockpit. This is the pure
// decision; App.tsx applies it (open a fleet tab / focus an existing one / nothing).
//
// Kept free of React and store access so it's exhaustively unit-testable across the
// connection-configured × existing-tab × launch-target × toggle matrix.

export type CockpitBootInputs = {
  /** The "Open fleet on launch" preference (default on). */
  openFleetOnLaunch: boolean;
  /** At least one fleet daemon connection is configured. */
  connectionConfigured: boolean;
  /** App was launched on an explicit dir/file target (CLI arg / "Open With"). */
  hasExplicitLaunchTarget: boolean;
  /** Id of a fleet tab already present in the restored active space, else null. */
  existingFleetTabId: number | null;
};

export type CockpitBootAction =
  /** Leave the restored workspace as-is (ADE boot, or yielding to a launch target). */
  | { kind: "none" }
  /** Focus the fleet tab already restored in the active space. */
  | { kind: "focus"; tabId: number }
  /** Open a new fleet tab and make it active. */
  | { kind: "open" };

/**
 * Decide what the cockpit-first boot should do. Precedence, highest first:
 *  1. An explicit launch target (glance <path> / "Open With") always wins — the
 *     user asked for that file/folder, so never shove the cockpit in front of it.
 *  2. The "Open fleet on launch" toggle being off — the escape hatch, honored
 *     without making the user delete their connection.
 *  3. No connection configured — ADE boot is unchanged; don't push an empty
 *     cockpit at someone who never set one up.
 *  4. A fleet tab already restored in the active space — just focus it.
 *  5. Otherwise — open a fresh fleet tab as the landing surface.
 */
export function planCockpitBoot(inputs: CockpitBootInputs): CockpitBootAction {
  if (inputs.hasExplicitLaunchTarget) return { kind: "none" };
  if (!inputs.openFleetOnLaunch) return { kind: "none" };
  if (!inputs.connectionConfigured) return { kind: "none" };
  if (inputs.existingFleetTabId !== null)
    return { kind: "focus", tabId: inputs.existingFleetTabId };
  return { kind: "open" };
}
