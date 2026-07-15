// Attention-notification logic for the bell (fleet-ide-cockpit C08). Pure + separate from the
// poller so "which units just started needing a human" is unit-testable. The daemon's web-push
// lane fires the same alert server-side; this is the cockpit's native, in-app equivalent.

import type { FleetUnit } from "./fleetRoster";
import { whyStopped } from "./fleetIntervene";

/** A unit is "in attention" exactly when it wants a human — input or error (rank ≤ 1). */
export function isAttention(u: Pick<FleetUnit, "status">): boolean {
  return u.status === "input" || u.status === "error";
}

export interface AttentionAlert {
  unitId: string;
  title: string;
  body: string;
}

/**
 * Diff two roster snapshots and return an alert for each unit that JUST entered attention —
 * present-and-attention now, but not attention (or not present) before. `alreadyNotified` holds
 * unit ids still in a notified attention state, so a unit that stays blocked doesn't re-alert
 * every 2s poll (collapse). Returns the alerts to fire AND the next notified-set to keep.
 */
export function attentionTransitions(
  prev: FleetUnit[],
  next: FleetUnit[],
  alreadyNotified: ReadonlySet<string>,
): { alerts: AttentionAlert[]; notified: Set<string> } {
  const prevAttention = new Set(prev.filter(isAttention).map((u) => u.id));
  const nextAttention = new Set(next.filter(isAttention).map((u) => u.id));

  // Keep only ids that are STILL in attention — a unit that recovered leaves the set, so a later
  // re-entry alerts again.
  const notified = new Set<string>();
  for (const id of alreadyNotified) if (nextAttention.has(id)) notified.add(id);

  const alerts: AttentionAlert[] = [];
  for (const u of next) {
    if (!isAttention(u)) continue;
    if (prevAttention.has(u.id) || notified.has(u.id)) continue; // was already blocked → no re-alert
    const why = whyStopped(u);
    alerts.push({
      unitId: u.id,
      title:
        u.status === "input" ? `⛔ ${u.name} needs you` : `⚠ ${u.name} errored`,
      body: why.detail,
    });
    notified.add(u.id);
  }
  return { alerts, notified };
}
