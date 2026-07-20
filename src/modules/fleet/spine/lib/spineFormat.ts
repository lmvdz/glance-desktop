// Pure display-string helpers for the thread spine (t3-face concern 05). Split out of the old
// RosterView so both the spine rows and any future consumer (e.g. a command-palette "jump to
// unit" entry) can share them, and so they're unit-testable without mounting a component.

import type { FleetUnit } from "../../lib/fleetRoster";

/** "$1.23" / "<$0.01" / null (no receipt yet). Ported verbatim from RosterView. */
export function fmtCost(n?: number): string | null {
  if (n == null) return null;
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

/** "repo · branch" (or bare "repo" with no branch) — the tooltip-grade identity line for a unit
 *  row. Ported verbatim from RosterView; the spine keeps this OFF the row itself (the project
 *  group header already carries the project identity) and puts it in the row's `title` instead. */
export function repoLabel(u: FleetUnit): string {
  const repo =
    u.repoName ?? u.repo.split(/[\\/]/).filter(Boolean).pop() ?? u.repo;
  return u.branch ? `${repo} · ${u.branch}` : repo;
}

/** The grouping key for "project" — the same repo-name-or-basename derivation as `repoLabel`,
 *  minus the branch, shared by both unit rows (FleetUnit.repo/repoName) and adoptable-session rows
 *  (AdoptableSession.cwd/repoName) so they land in the same project group. */
export function projectKeyFor(repoPath: string, repoName?: string): string {
  return repoName ?? repoPath;
}

export function projectLabelFor(repoPath: string, repoName?: string): string {
  return (
    repoName ?? repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath
  );
}
