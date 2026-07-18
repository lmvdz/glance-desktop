// Row derivation for the t3-face reasoning-first timeline (t3-face C09).
//
// Ports the FOLD-DERIVATION *shape* of t3code's MessagesTimeline.logic.ts
// (pingdotgg/t3code, apps/web/src/components/chat/MessagesTimeline.logic.ts —
// © 2026 T3 Tools Inc., MIT License) — not its data layer. t3 keys folding off a
// server-assigned `turnId` plus a separate `latestTurn`/`runningTurnId` API that
// glance's transcript doesn't have; here, turn boundaries are derived structurally
// from `kind:"user"` entries (plans/t3-face/09-timeline-rewrite.md), which also
// gives foreign/ACP-harness transcripts a for-free flat-list fallback: a
// transcript with zero `kind:"user"` entries has exactly one (unfoldable) group.
//
// t3's key anti-flicker insight, ported directly: whether a turn folds must be
// driven by something MONOTONIC, never by a transient status snapshot. t3 uses
// "is this the (possibly still-lagging) latest turn"; we use "is this the last
// user-boundary group in the array" — once a turn is superseded by a later user
// entry it is permanently non-last and folds, and it never re-expands no matter
// how its entries' `status` fields later settle. Only the FOLD LABEL ("Worked for
// Xm" vs "You stopped after Xm") may still update after that point, which is a
// legitimate one-time correction as the daemon finally reports truth — not flicker.

import type { TranscriptEntry } from "../lib/fleetTranscript";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 1;

export interface WorkRow {
  kind: "work";
  id: string;
  groupId: string;
  /** The (at most MAX_VISIBLE_WORK_LOG_ENTRIES) entries always shown, most-recent last. */
  visible: TranscriptEntry[];
  /** Earlier entries in this consecutive tool run, hidden behind "+N previous tool calls". */
  hidden: TranscriptEntry[];
  expanded: boolean;
}

export interface TurnFoldRow {
  kind: "turn-fold";
  id: string;
  turnIndex: number;
  label: string;
  expanded: boolean;
  /** Row ids folded behind this row when `expanded` is false. */
  hiddenIds: ReadonlySet<string>;
}

export interface MessageRow {
  kind: "message";
  id: string;
  entry: TranscriptEntry;
}

export interface WorkingRow {
  kind: "working";
  id: "working-indicator";
  /** ts of the earliest still-running entry in the active turn — drives the "Working for Xs" timer. */
  startedAt: number | null;
}

export type TimelineRow = WorkRow | TurnFoldRow | MessageRow | WorkingRow;

export interface DeriveRowsOptions {
  expandedTurns?: ReadonlySet<string>;
  expandedWorkGroups?: ReadonlySet<string>;
}

/** Stable per-entry key: prefers the daemon's append id, then seq, then an optimistic
 *  clientTurnId, falling back to array position only for legacy entries with none of those
 *  (mirrors ConversationView's pre-rewrite key derivation). */
export function rowKeyForEntry(e: TranscriptEntry, arrayIndex: number): string {
  return e.id ?? (e.seq !== undefined ? `seq:${e.seq}` : (e.clientTurnId ?? `idx:${arrayIndex}`));
}

/** True for an entry the daemon can still mutate in place — a running assistant/thinking/tool
 *  entry. Mirrors fleetTranscript.ts's isUnsettled (not exported there) so a pending host-gate
 *  (kind:"system", status:"running") never counts as "still working". */
function isRunning(e: TranscriptEntry): boolean {
  return e.status === "running" && e.kind !== "system";
}

/** True for an entry that never reached a clean outcome — still running, or explicitly cancelled
 *  (the status a steer/interrupt leaves behind). Both mean "this turn didn't get to finish", which
 *  is exactly the "You stopped after Xm" case; only "ok"/"error" count as a settled, non-interrupted
 *  outcome. */
function wasNotCleanlyResolved(e: TranscriptEntry): boolean {
  return isRunning(e) || e.status === "cancelled";
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

interface IndexedEntry {
  entry: TranscriptEntry;
  arrayIndex: number;
}

interface TurnGroup {
  /** -1 = prelude — entries that arrived before any `kind:"user"` entry. Never folded: there is no
   *  boundary to fold it behind. A transcript with NO user entries at all is entirely one prelude
   *  group, which is exactly the graceful flat-list fallback for a user-boundary-less harness. */
  turnIndex: number;
  entries: IndexedEntry[];
}

function groupByTurn(entries: TranscriptEntry[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let current: TurnGroup | null = null;
  let turnIndex = -1;
  entries.forEach((entry, arrayIndex) => {
    if (entry.kind === "user") {
      turnIndex += 1;
      current = { turnIndex, entries: [] };
      groups.push(current);
    } else if (!current) {
      current = { turnIndex: -1, entries: [] };
      groups.push(current);
    }
    current.entries.push({ entry, arrayIndex });
  });
  return groups;
}

/** Group a flat run of entries into rows: consecutive `kind:"tool"` entries collapse into one
 *  `work` row (only the last MAX_VISIBLE_WORK_LOG_ENTRIES shown, rest behind a toggle); everything
 *  else becomes its own `message` row, in order. Used both for an unfolded (prelude/last-turn) run
 *  and for a folded turn's hidden entries once expanded. */
function pushFlatRows(
  rows: TimelineRow[],
  items: IndexedEntry[],
  expandedWorkGroups: ReadonlySet<string>,
  turnIndex: number,
): void {
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.entry.kind === "tool") {
      const runStart = i;
      while (i < items.length && items[i].entry.kind === "tool") i += 1;
      const run = items.slice(runStart, i);
      const groupId = `work:${turnIndex}:${rowKeyForEntry(run[0].entry, run[0].arrayIndex)}`;
      if (run.length <= MAX_VISIBLE_WORK_LOG_ENTRIES) {
        rows.push({
          kind: "work",
          id: groupId,
          groupId,
          visible: run.map((r) => r.entry),
          hidden: [],
          expanded: true,
        });
      } else {
        const expanded = expandedWorkGroups.has(groupId);
        const hiddenRun = run.slice(0, -MAX_VISIBLE_WORK_LOG_ENTRIES);
        const visibleRun = run.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES);
        rows.push({
          kind: "work",
          id: groupId,
          groupId,
          visible: visibleRun.map((r) => r.entry),
          hidden: hiddenRun.map((r) => r.entry),
          expanded,
        });
      }
      continue;
    }
    rows.push({
      kind: "message",
      id: rowKeyForEntry(item.entry, item.arrayIndex),
      entry: item.entry,
    });
    i += 1;
  }
}

export function deriveTimelineRows(
  entries: TranscriptEntry[],
  options: DeriveRowsOptions = {},
): TimelineRow[] {
  const expandedTurns = options.expandedTurns ?? new Set<string>();
  const expandedWorkGroups = options.expandedWorkGroups ?? new Set<string>();
  const groups = groupByTurn(entries);
  if (groups.length === 0) return [];

  // turnIndex is non-decreasing as we scan forward, so the max-index group is always the last one.
  const activeGroup = groups[groups.length - 1];
  const maxTurnIndex = activeGroup.turnIndex;

  const rows: TimelineRow[] = [];

  for (const [gi, group] of groups.entries()) {
    const isPrelude = group.turnIndex === -1;
    const isLastTurn = !isPrelude && group.turnIndex === maxTurnIndex;

    const first = group.entries[0];
    const hasLeadingUser = first?.entry.kind === "user";
    const leadingUser = hasLeadingUser ? first : null;
    const rest = hasLeadingUser ? group.entries.slice(1) : group.entries;

    // The turn's own prompt is always visible — never part of the foldable body.
    if (leadingUser) {
      rows.push({
        kind: "message",
        id: rowKeyForEntry(leadingUser.entry, leadingUser.arrayIndex),
        entry: leadingUser.entry,
      });
    }

    if (isPrelude || isLastTurn) {
      pushFlatRows(rows, rest, expandedWorkGroups, group.turnIndex);
      continue;
    }

    // Non-last, non-prelude turn: fold candidate. The terminal assistant message (the turn's
    // outcome) stays visible below the fold even when the fold is collapsed — only the
    // commentary/tool trail leading up to it hides.
    let terminalIdx = -1;
    for (let i = rest.length - 1; i >= 0; i -= 1) {
      if (rest[i].entry.kind === "assistant") {
        terminalIdx = i;
        break;
      }
    }
    const terminal = terminalIdx >= 0 ? rest[terminalIdx] : null;
    const hidden = rest.filter((_, i) => i !== terminalIdx);

    if (hidden.length === 0) {
      pushFlatRows(rows, rest, expandedWorkGroups, group.turnIndex);
      continue;
    }

    const turnFoldId = `turn-fold:${group.turnIndex}`;
    const wasInterrupted =
      hidden.some(({ entry }) => wasNotCleanlyResolved(entry)) ||
      (terminal ? wasNotCleanlyResolved(terminal.entry) : false);
    const startTs = leadingUser?.entry.ts ?? rest[0]?.entry.ts ?? 0;
    // A cleanly-finished turn's elapsed time ends at its own last entry (idle time before the user
    // types the NEXT message is not "worked" time). An interrupted turn's last entry never got a
    // final timestamp (it's frozen mid-stream) — the only real end-of-work signal we have is the ts
    // of the next turn's user entry, since that's the instant the steer/interrupt actually fired.
    const nextTurnStartTs = groups[gi + 1]?.entries[0]?.entry.ts;
    const endTs = wasInterrupted
      ? (nextTurnStartTs ?? rest[rest.length - 1]?.entry.ts ?? startTs)
      : (rest[rest.length - 1]?.entry.ts ?? startTs);
    const elapsedMs = Math.max(0, endTs - startTs);
    const label = wasInterrupted
      ? `You stopped after ${formatDuration(elapsedMs)}`
      : `Worked for ${formatDuration(elapsedMs)}`;

    const expanded = expandedTurns.has(turnFoldId);
    const hiddenIds = new Set(hidden.map(({ entry, arrayIndex }) => rowKeyForEntry(entry, arrayIndex)));

    rows.push({
      kind: "turn-fold",
      id: turnFoldId,
      turnIndex: group.turnIndex,
      label,
      expanded,
      hiddenIds,
    });

    if (expanded) {
      pushFlatRows(rows, hidden, expandedWorkGroups, group.turnIndex);
    }
    if (terminal) {
      rows.push({
        kind: "message",
        id: rowKeyForEntry(terminal.entry, terminal.arrayIndex),
        entry: terminal.entry,
      });
    }
  }

  const runningInActiveGroup = activeGroup.entries.filter(({ entry }) => isRunning(entry));
  if (runningInActiveGroup.length > 0) {
    const startedAt = Math.min(...runningInActiveGroup.map(({ entry }) => entry.ts));
    rows.push({ kind: "working", id: "working-indicator", startedAt });
  }

  return rows;
}

// Minimap geometry — direct value-only port of t3code's constants/helpers (MessagesTimeline.logic.ts
// lines 13-38, © 2026 T3 Tools Inc., MIT License): spacing/height/percent math has no data-layer
// dependency, so it ports verbatim; only the doc comments were trimmed to glance's context.
export const TIMELINE_MINIMAP_ITEM_SPACING = 8;
export const TIMELINE_MINIMAP_MIN_ITEMS = 2;
export const TIMELINE_MINIMAP_MAX_HEIGHT_CSS = "calc(100vh - 18rem)";

/** CSS height for the minimap rail: natural spacing per dot, capped so a very long conversation's
 *  rail doesn't outgrow the viewport. */
export function resolveTimelineMinimapHeightStyle(itemCount: number): string {
  const naturalHeight = Math.max(1, (itemCount - 1) * TIMELINE_MINIMAP_ITEM_SPACING);
  return `min(${naturalHeight}px, ${TIMELINE_MINIMAP_MAX_HEIGHT_CSS})`;
}

/** A dot's vertical position along the rail as a percentage, by array index — matches
 *  `deriveMinimapDots`' array-index positioning (not `seq`, which has manager-global gaps). */
export function resolveTimelineMinimapTopPercent(index: number, itemCount: number): number {
  if (itemCount <= 1) return 0;
  return (Math.max(0, Math.min(index, itemCount - 1)) / (itemCount - 1)) * 100;
}

export interface MinimapDot {
  id: string;
  arrayIndex: number;
}

/** One dot per `kind:"user"` entry, positioned by ARRAY INDEX — `seq` is manager-global with gaps
 *  (t3-face C04) and would misplace dots along the rail relative to how far through the visible
 *  conversation they actually sit. */
export function deriveMinimapDots(entries: TranscriptEntry[]): MinimapDot[] {
  const dots: MinimapDot[] = [];
  entries.forEach((entry, arrayIndex) => {
    if (entry.kind === "user") {
      dots.push({ id: rowKeyForEntry(entry, arrayIndex), arrayIndex });
    }
  });
  return dots;
}
