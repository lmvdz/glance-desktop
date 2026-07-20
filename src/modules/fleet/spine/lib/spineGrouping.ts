// Pure grouping/sort helpers for the thread spine (t3-face concern 05, the R2 centerpiece). Ports
// the SHAPE of t3code's Sidebar.logic.ts grouping helpers (pingdotgg/t3code,
// apps/web/src/components/Sidebar.logic.ts, MIT) — group by project then daemon/host, roll up a
// group's attention state — reimplemented against glance's own FleetUnit/AdoptableSession wire
// shapes rather than ported verbatim (t3's version is keyed on its own thread/project entity
// types that don't exist here).
//
// t3-face concern 07: the per-unit tier is now the daemon's (`FleetUnit.ladderPriority`, concern 06);
// this file no longer derives a rung from raw status. A group's roll-up is `maxLadderPriority` over
// its units' SERVER tiers — the exact function the daemon's own `GET /api/attention/ladder` runs,
// applied at the cockpit's project×daemon grouping (which spans merged daemons and keys on repoName,
// a granularity the daemon's per-repo/single-daemon roll-up can't be mapped onto — see fleetLadder.ts
// and the PR body's spec-deviation note). Ordering folds the same server tier via `ladderRank`.

import type { AdoptableSession } from "../../lib/fleetAdopt";
import {
  ladderRank,
  type LadderPriority,
  maxLadderPriority,
  needsHuman,
} from "../../lib/fleetLadder";
import { type FleetUnit, sortUnits, unitKey } from "../../lib/fleetRoster";
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
  /** Roll-up sort rank — `ladderRank(rollupPriority)` over the group's SERVER tiers (LOWER floats
   *  higher). A group with no units (adopt-only) sorts below every real unit group but still above
   *  nothing, at `ADOPT_ONLY_RANK`. */
  rank: number;
  /** True when at least one unit in the group is in the daemon's attention set (`needsHuman`) —
   *  drives the group header's roll-up dot color/pulse via `rollupPriority`. */
  hasAttention: boolean;
  /** The group's most-urgent unit's server tier (`maxLadderPriority`) — undefined for an adopt-only
   *  group (nothing to roll up). Feeds the header's chevron-slot dot. */
  rollupPriority?: LadderPriority;
  daemonGroups: SpineDaemonGroup[];
}

/** One below `idle` (`ladderRank`'s lowest real rank) — an adopt-only project group is real work
 *  waiting for a human, so it still floats above nothing, just below any unit-bearing group. */
const ADOPT_ONLY_RANK = ladderRank("idle") + 1;

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
      const rollupPriority = groupUnits.length
        ? maxLadderPriority(groupUnits.map((u) => u.ladderPriority))
        : undefined;
      const rank = groupUnits.length
        ? ladderRank(rollupPriority)
        : ADOPT_ONLY_RANK;
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
        hasAttention: groupUnits.some(needsHuman),
        rollupPriority,
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
