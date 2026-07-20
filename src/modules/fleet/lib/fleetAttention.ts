// Attention-notification logic for the OS-notification bell (fleet-ide-cockpit C08). Pure + separate
// from the poller so "which units just started needing a human" is unit-testable. The daemon's
// web-push lane fires the same alert server-side; this is the cockpit's native, in-app equivalent.
//
// t3-face concern 07: "needs a human" is no longer decided from raw status here — it is the daemon's
// server-computed tier (via `needsHuman`, concern 06), read from fleetLadder. The alert title and
// body come from fleetLadder too, so this module makes no ordering decision of its own.

import { ladderAlertTitle, ladderReason, needsHuman } from "./fleetLadder";
import type { FleetUnit } from "./fleetRoster";
import { unitKey } from "./fleetRoster";

/** A unit is "in attention" exactly when the daemon put it in the needs-you set (error /
 *  pending-approval / awaiting-input) — see fleetLadder's `needsHuman`. */
export function isAttention(u: FleetUnit): boolean {
  return needsHuman(u);
}

export interface AttentionAlert {
  unitId: string;
  /** The unit's source daemon (M02) — carried so a click can select the right daemon's unit even
   *  when its id collides with a same-id unit on another daemon. */
  daemonId: string;
  title: string;
  body: string;
}

/**
 * Diff two roster snapshots and return an alert for each unit that JUST entered attention —
 * present-and-attention now, but not attention (or not present) before. `alreadyNotified` holds
 * `daemonId:unitId` keys still in a notified attention state, so a unit that stays blocked
 * doesn't re-alert every 2s poll (collapse), and the SAME unit id on two daemons is tracked
 * independently. Returns the alerts to fire AND the next notified-set to keep.
 */
export function attentionTransitions(
  prev: FleetUnit[],
  next: FleetUnit[],
  alreadyNotified: ReadonlySet<string>,
): { alerts: AttentionAlert[]; notified: Set<string> } {
  const prevAttention = new Set(prev.filter(isAttention).map(unitKey));
  const nextAttention = new Set(next.filter(isAttention).map(unitKey));

  // Keep only keys that are STILL in attention — a unit that recovered leaves the set, so a
  // later re-entry alerts again.
  const notified = new Set<string>();
  for (const key of alreadyNotified)
    if (nextAttention.has(key)) notified.add(key);

  const alerts: AttentionAlert[] = [];
  for (const u of next) {
    if (!isAttention(u)) continue;
    const key = unitKey(u);
    if (prevAttention.has(key) || notified.has(key)) continue; // was already blocked → no re-alert
    alerts.push({
      unitId: u.id,
      daemonId: u.daemonId,
      title: ladderAlertTitle(u),
      body: ladderReason(u),
    });
    notified.add(key);
  }
  return { alerts, notified };
}
