// Structural sharing for derived timeline rows (r3 borrow 5 — plans/research-t3code round 3).
//
// Ports the *shape* of t3code's `computeStableMessagesTimelineRows` (MessagesTimeline.logic.ts,
// © 2026 T3 Tools Inc., MIT License): `deriveTimelineRows` necessarily produces a fresh array of
// fresh row objects on every call, so with a 1.5s transcript poll every row object's identity
// changes every tick even when nothing on screen did — which silently defeats `memo()` on the row
// components (they re-render on reference inequality). This pass diffs each freshly-derived row
// against the previous render's row BY ID with a variant-specific shallow comparator and reuses
// the previous object when unchanged. `mergeTranscript` already preserves TranscriptEntry object
// identity for unchanged re-deliveries (fleetTranscript.ts), so entry-reference equality here is
// a real signal, not a coincidence.
//
// Without this pass, memoizing the row components would be a silent no-op — that exact trap is
// called out in the research brief; keep this file and the `memo()` wrappers together.

import type { TimelineRow } from "./deriveRows";

function sameEntryArray(
  a: readonly unknown[],
  b: readonly unknown[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Variant-specific shallow equality: true when `next` renders identically to `prev`. */
function rowUnchanged(prev: TimelineRow, next: TimelineRow): boolean {
  if (prev.kind !== next.kind) return false;
  switch (next.kind) {
    case "message":
      // Entry object identity — mergeTranscript keeps the same reference for unchanged entries.
      return prev.kind === "message" && prev.entry === next.entry;
    case "work":
      return (
        prev.kind === "work" &&
        prev.expanded === next.expanded &&
        sameEntryArray(prev.visible, next.visible) &&
        sameEntryArray(prev.hidden, next.hidden)
      );
    case "turn-fold":
      return (
        prev.kind === "turn-fold" &&
        prev.label === next.label &&
        prev.expanded === next.expanded &&
        sameIdSet(prev.hiddenIds, next.hiddenIds)
      );
    case "working":
      return prev.kind === "working" && prev.startedAt === next.startedAt;
    default:
      return false;
  }
}

/**
 * Reuse previous row objects (matched by id) that are unchanged under `rowUnchanged`; when every
 * row is reused and the ordering/length match, the PREVIOUS ARRAY itself is returned so even the
 * list-level identity is stable across idle poll ticks. Pure.
 */
export function stabilizeRows(
  prev: readonly TimelineRow[],
  next: TimelineRow[],
): TimelineRow[] {
  if (prev.length === 0) return next;
  const prevById = new Map<string, TimelineRow>();
  for (const row of prev) prevById.set(row.id, row);

  let allReused = prev.length === next.length;
  const out: TimelineRow[] = new Array(next.length);
  for (let i = 0; i < next.length; i += 1) {
    const fresh = next[i];
    const old = prevById.get(fresh.id);
    if (old && rowUnchanged(old, fresh)) {
      out[i] = old;
      if (allReused && prev[i] !== old) allReused = false;
    } else {
      out[i] = fresh;
      allReused = false;
    }
  }
  return allReused ? (prev as TimelineRow[]) : out;
}
