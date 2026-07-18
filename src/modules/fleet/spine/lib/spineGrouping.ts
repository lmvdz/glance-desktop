// Pure grouping/sort helpers for the thread spine (t3-face concern 05, the R2 centerpiece). Ports
// the SHAPE of t3code's Sidebar.logic.ts grouping helpers (pingdotgg/t3code,
// apps/web/src/components/Sidebar.logic.ts, MIT) — group by project then daemon/host, roll up a
// group's attention state — reimplemented against glance's own FleetUnit/AdoptableSession wire
// shapes rather than ported verbatim (t3's version is keyed on its own thread/project entity
// types that don't exist here). t3's status CASCADE (which state wins when a project mixes
// statuses) is deliberately NOT ported: concern 07 replaces the roll-up source with the daemon's
// `/api/attention/ladder` and this client-side `rank`/`rollupStatus` computation is deleted, not
// extended — see plans/t3-face/07-spine-server-ladder.md and DESIGN.md's "Attention ladder" row.

import type { AdoptableSession } from "../../lib/fleetAdopt";
import {
  type FleetStatus,
  type FleetUnit,
  attentionUnits,
  rankUnit,
  sortUnits,
  unitKey,
} from "../../lib/fleetRoster";
import { projectKeyFor, projectLabelFor } from "./spineFormat";

export type SpineRow =
  | { kind: "unit"; key: string; unit: FleetUnit }
  | { kind: "adopt"; key: string; session: AdoptableSession };

export interface SpineDaemonGroup {
  /** The unit's `daemonId`, or `activeDaemon.id` for an adopt-only bucket (presence is only ever
   *  polled from the ACTIVE connection — see the old AdoptableSessions widget's own comment,
   *  preserved in useAdoptableSessions.ts). */
  daemonId: string;
  daemonLabel: string;
  rows: SpineRow[];
}

export interface SpineProjectGroup {
  projectKey: string;
  projectLabel: string;
  /** Client roll-up rank — the MINIMUM `rankUnit()` among this group's units (v1 only; see the
   *  file header). A group with no units (adopt-only) sorts below every real unit group but still
   *  above nothing, at `ADOPT_ONLY_RANK`. */
  rank: number;
  /** True when at least one unit in the group is in the attention queue (`attentionUnits`) —
   *  drives the group header's roll-up dot color/pulse via `rollupStatus`. */
  hasAttention: boolean;
  /** The status of the group's highest-priority unit (lowest `rankUnit`) — undefined for an
   *  adopt-only group (nothing to roll up). Feeds the header's chevron-slot dot. */
  rollupStatus?: FleetStatus;
  daemonGroups: SpineDaemonGroup[];
}

/** One below "stopped" (rankUnit's lowest real rank, 7) — an adopt-only project group is real
 *  work waiting for a human, so it still floats above nothing, just below any unit-bearing group. */
const ADOPT_ONLY_RANK = 8;

interface BuildingDaemon {
  daemonLabel: string;
  rows: SpineRow[];
}
interface BuildingProject {
  projectLabel: string;
  daemons: Map<string, BuildingDaemon>;
}

/**
 * Group units + adoptable sessions by project, then by daemon/host, in one pass. Units are walked
 * in `sortUnits` order (attention rank, then name) so every daemon bucket's row order is already
 * deterministic without a second sort. `activeDaemon` is null before the connection store
 * hydrates (adoptable sessions are dropped for that one render — they always belong to the active
 * daemon's presence poll, so with no active daemon there's nothing to attribute them to).
 */
export function buildSpineGroups(
  units: FleetUnit[],
  adoptable: AdoptableSession[],
  activeDaemon: { id: string; label: string } | null,
): SpineProjectGroup[] {
  const projects = new Map<string, BuildingProject>();

  const ensureProject = (key: string, label: string): BuildingProject => {
    let p = projects.get(key);
    if (!p) {
      p = { projectLabel: label, daemons: new Map() };
      projects.set(key, p);
    }
    return p;
  };
  const ensureDaemon = (
    p: BuildingProject,
    id: string,
    label: string,
  ): BuildingDaemon => {
    let d = p.daemons.get(id);
    if (!d) {
      d = { daemonLabel: label, rows: [] };
      p.daemons.set(id, d);
    }
    return d;
  };

  for (const u of sortUnits(units)) {
    const key = projectKeyFor(u.repo, u.repoName);
    const p = ensureProject(key, projectLabelFor(u.repo, u.repoName));
    const d = ensureDaemon(p, u.daemonId, u.daemonLabel ?? u.daemonId);
    d.rows.push({ kind: "unit", key: unitKey(u), unit: u });
  }

  if (activeDaemon) {
    for (const s of adoptable) {
      const key = projectKeyFor(s.cwd, s.repoName);
      const p = ensureProject(key, projectLabelFor(s.cwd, s.repoName));
      const d = ensureDaemon(p, activeDaemon.id, activeDaemon.label);
      d.rows.push({ kind: "adopt", key: `adopt:${s.key}`, session: s });
    }
  }

  const groups: SpineProjectGroup[] = [...projects.entries()].map(
    ([projectKey, p]) => {
      const unitRows = [...p.daemons.values()].flatMap((d) => d.rows);
      const groupUnits = unitRows
        .filter(
          (r): r is Extract<SpineRow, { kind: "unit" }> => r.kind === "unit",
        )
        .map((r) => r.unit);
      const rank = groupUnits.length
        ? Math.min(...groupUnits.map(rankUnit))
        : ADOPT_ONLY_RANK;
      const rollupStatus = groupUnits.length
        ? sortUnits(groupUnits)[0].status
        : undefined;
      const daemonGroups: SpineDaemonGroup[] = [...p.daemons.entries()]
        .map(([daemonId, d]) => ({
          daemonId,
          daemonLabel: d.daemonLabel,
          rows: d.rows,
        }))
        .sort((a, b) => a.daemonLabel.localeCompare(b.daemonLabel));
      return {
        projectKey,
        projectLabel: p.projectLabel,
        rank,
        hasAttention: attentionUnits(groupUnits).length > 0,
        rollupStatus,
        daemonGroups,
      };
    },
  );

  return groups.sort(
    (a, b) => a.rank - b.rank || a.projectLabel.localeCompare(b.projectLabel),
  );
}

/** Host/daemon badges (the sub-header line under a project group) only earn their space once ≥2
 *  daemons actually appear across the GROUPED roster — derived from the build output so an
 *  adopt-only daemon counts toward disambiguation too, not just RosterView's old
 *  `connections.length > 1` (configured, not necessarily populated) gate. */
export function shouldShowHostBadges(groups: SpineProjectGroup[]): boolean {
  const daemonIds = new Set<string>();
  for (const g of groups)
    for (const d of g.daemonGroups) daemonIds.add(d.daemonId);
  return daemonIds.size > 1;
}
