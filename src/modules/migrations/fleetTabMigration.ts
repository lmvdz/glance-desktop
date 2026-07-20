import type { SerializedTab } from "@/modules/spaces/lib/serialize";

/**
 * One-time restore-path migration for hub-shell concern H0.
 *
 * The `fleet` tab kind is retired: the fleet surface is no longer a tab inside
 * terax's IDE frame but the app's default shell (see `HubShell`). Sessions
 * persisted before this change can still hold `{ kind: "fleet" }` entries in a
 * space's serialized tab list. Left in place they would hydrate into tabs that
 * nothing renders any more (the `FleetStack` slot is gone from
 * `WorkspaceSurface`), leaving dead, unfocusable ghosts in the strip.
 *
 * This drops those legacy entries during restore. It's a pure array transform
 * so it's trivially unit-testable and has no I/O of its own — the boot path
 * (`useSpacesBoot`) applies it to each space's persisted tabs before hydration.
 * The `{ kind: "fleet" }` variant is retained in `SerializedTab` for exactly
 * this reader; it can be removed a release from now once no persisted state
 * carries it.
 */
export function dropFleetTabs(tabs: SerializedTab[]): SerializedTab[] {
  if (!Array.isArray(tabs)) return [];
  return tabs.filter((t) => t.kind !== "fleet");
}
