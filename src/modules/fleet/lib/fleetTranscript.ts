// The unit's live ACP conversation (fleet-ide-intervention I03). Mirrors the daemon's
// TranscriptEntry wire shape (src/types.ts on the daemon side — TranscriptEntry ~L187-208,
// TranscriptTool ~L167-178); the reducer merges delta-poll batches
// (GET /api/agents/:id/transcript?since=seq) into one growing, ordered, deduped conversation.
// Pure + separate from the poller so it's testable.
//
// t3-face C04: the daemon mutates a streaming entry IN PLACE (assistant text growing, a tool's
// status flipping running→ok) without ever bumping `seq` — finalization arrives over a WS channel
// the webview's CSP blocks, so the client never sees it directly; it only learns about a mutation
// by re-fetching that entry's seq from the daemon's strictly-`seq > since` delta endpoint. That
// forces the poll cursor to be `runningFloor`, not `maxSeq` — see below.

export type TranscriptKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "system";

export type TranscriptStatus = "running" | "ok" | "error" | "cancelled";

export interface TranscriptTool {
  /** The daemon's per-invocation id — stable across the running→done mutation of one tool call. */
  callId?: string;
  name: string;
  /** Raw structured args, when the daemon includes them (rarer than `argsText`). */
  args?: unknown;
  argsText?: string;
  /** Raw structured result, when the daemon includes it (rarer than `resultText`). */
  result?: unknown;
  resultText?: string;
  /** A partial/streaming result the daemon may attach before the tool settles. */
  partial?: unknown;
  partialText?: string;
  isError?: boolean;
  durationMs?: number;
}

export type TranscriptFormat = "markdown" | "command" | "stage" | "plain";

/** A host-permission / input gate the operator must resolve (kind:"system" entries only). Appended
 *  once as `status:"running"` and never mutated in place — it resolves via a NEW entry, not an edit,
 *  which is exactly why it must be excluded from `runningFloor` (see below). */
export interface TranscriptPending {
  requestId: string;
  action: "created" | "answered" | "cancelled";
}

export interface TranscriptEntry {
  /** Stable append id. Older persisted transcripts may not have one. */
  id?: string;
  /** Monotonic manager-local sequence — the cursor for delta polling and the sort key. Manager-global,
   *  not per-agent — per-agent gaps are normal. Never use it for positional math; use array index. */
  seq?: number;
  kind: TranscriptKind;
  text: string;
  ts: number;
  clientTurnId?: string;
  /** What the user typed, when it differs from the context-augmented `text` the agent got. */
  displayText?: string;
  status?: TranscriptStatus;
  tool?: TranscriptTool;
  format?: TranscriptFormat;
  pending?: TranscriptPending;
}

export function normalizeTranscript(payload: unknown): TranscriptEntry[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (e): e is TranscriptEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as TranscriptEntry).kind === "string" &&
      typeof (e as TranscriptEntry).text === "string",
  );
}

/** The highest `seq` seen — 0 when none carry a seq. Was formerly used directly as the poll
 *  cursor; kept as the fallback `runningFloor` uses once nothing is still unsettled. */
export function maxSeq(entries: TranscriptEntry[]): number {
  return entries.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
}

/** True for an entry the daemon can still mutate in place: a `running` assistant/thinking/tool
 *  entry. `kind:"system"` is excluded even when `status:"running"` — a pending host-permission gate
 *  is appended running and resolves via a brand-new entry, never an in-place edit, so treating it
 *  as unsettled would pin the cursor floor forever (the gate can sit open for as long as the
 *  operator takes to answer it). */
function isUnsettled(e: TranscriptEntry): boolean {
  return e.status === "running" && e.kind !== "system";
}

/**
 * The delta-poll cursor (t3-face C04). The daemon's `GET .../transcript?since=` filter is a strict
 * `seq > since` (src/transcript-delta.ts on the daemon side), and streaming entries are mutated
 * IN PLACE without a new `seq` — so polling with `maxSeq` (the highest seq already seen) can never
 * re-observe a mutation to an entry at or below that seq; it freezes mid-stream forever.
 *
 * The fix: hold the cursor one below the lowest `seq` still `running` (excluding `system` pending
 * gates, see `isUnsettled`) so that entry — and everything the daemon appended after it — keeps
 * coming back on every poll until it settles. `mergeTranscript`'s seq-keyed upsert folds the
 * fresher copy in over the stale local one. When nothing is currently running, this is just
 * `maxSeq` — the normal steady-state cursor.
 */
export function runningFloor(entries: TranscriptEntry[]): number {
  let floor: number | undefined;
  for (const e of entries) {
    if (typeof e.seq !== "number" || !isUnsettled(e)) continue;
    if (floor === undefined || e.seq < floor) floor = e.seq;
  }
  return floor === undefined ? maxSeq(entries) : floor - 1;
}

/** Structural equality for entries coming off the wire (JSON-shaped: objects/arrays/primitives) —
 *  used by `mergeTranscript` to decide whether a re-delivered entry actually changed. Order of
 *  object keys doesn't matter (unlike a JSON.stringify comparison would demand). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(aRec[k], bRec[k]));
}

/**
 * Merge a delta batch into the accumulated transcript: append new entries, and de-dupe on `seq`
 * (then `id`) so a re-fetched or optimistically-inserted turn never doubles. Result is sorted by
 * `seq` (seq-less legacy/optimistic entries keep their arrival order at the tail). Pure.
 *
 * Preserves object IDENTITY for a re-delivered entry that hasn't actually changed (the running
 * floor above means unsettled entries are re-fetched on every poll, delivering a structurally
 * identical copy most of the time) — the local list keeps the SAME reference so CSS pulse/glow
 * animations keyed on the entry object don't restart every poll tick.
 */
export function mergeTranscript(
  prev: TranscriptEntry[],
  delta: TranscriptEntry[],
): TranscriptEntry[] {
  const bySeq = new Map<number, TranscriptEntry>();
  const byId = new Map<string, TranscriptEntry>();
  const seqless: TranscriptEntry[] = [];
  const add = (e: TranscriptEntry, fromDelta: boolean) => {
    if (typeof e.seq === "number") {
      const existing = fromDelta ? bySeq.get(e.seq) : undefined;
      // Unchanged re-delivery: keep the PREVIOUS reference, not the freshly-parsed delta object.
      if (existing && deepEqual(existing, e)) return;
      bySeq.set(e.seq, e);
    } else if (e.id) {
      const existing = fromDelta ? byId.get(e.id) : undefined;
      if (existing && deepEqual(existing, e)) return;
      byId.set(e.id, e);
    } else {
      seqless.push(e);
    }
  };
  for (const e of prev) add(e, false);
  for (const e of delta) add(e, true);
  const sequenced = [...bySeq.values()].sort(
    (a, b) => (a.seq ?? 0) - (b.seq ?? 0),
  );
  return [...sequenced, ...byId.values(), ...seqless];
}

/** Drop optimistic user turns (no seq, carrying a clientTurnId) once the server echoes them back —
 *  the server entry carries the same clientTurnId WITH a seq, so the optimistic placeholder is stale. */
export function reconcileOptimistic(
  entries: TranscriptEntry[],
): TranscriptEntry[] {
  const confirmedTurnIds = new Set(
    entries
      .filter((e) => e.seq !== undefined && e.clientTurnId)
      .map((e) => e.clientTurnId),
  );
  return entries.filter(
    (e) =>
      !(
        e.seq === undefined &&
        e.clientTurnId &&
        confirmedTurnIds.has(e.clientTurnId)
      ),
  );
}
