// The unit's live ACP conversation (fleet-ide-intervention I03). A trimmed mirror of the daemon's
// TranscriptEntry; the reducer merges delta-poll batches (GET /api/agents/:id/transcript?since=seq)
// into one growing, ordered, deduped conversation. Pure + separate from the poller so it's testable.

export type TranscriptKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "system";

export interface TranscriptTool {
  name: string;
  argsText?: string;
  resultText?: string;
}

export interface TranscriptEntry {
  id?: string;
  /** Monotonic manager-local sequence — the cursor for delta polling and the sort key. */
  seq?: number;
  kind: TranscriptKind;
  text: string;
  ts: number;
  clientTurnId?: string;
  /** What the user typed, when it differs from the context-augmented `text` the agent got. */
  displayText?: string;
  status?: "running" | "ok" | "error" | "cancelled";
  tool?: TranscriptTool;
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

/** The highest `seq` seen — the cursor to send as `?since=` on the next poll. 0 when none carry a seq. */
export function maxSeq(entries: TranscriptEntry[]): number {
  return entries.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
}

/**
 * Merge a delta batch into the accumulated transcript: append new entries, and de-dupe on `seq`
 * (then `id`) so a re-fetched or optimistically-inserted turn never doubles. Result is sorted by
 * `seq` (seq-less legacy/optimistic entries keep their arrival order at the tail). Pure.
 */
export function mergeTranscript(
  prev: TranscriptEntry[],
  delta: TranscriptEntry[],
): TranscriptEntry[] {
  const bySeq = new Map<number, TranscriptEntry>();
  const byId = new Map<string, TranscriptEntry>();
  const seqless: TranscriptEntry[] = [];
  const add = (e: TranscriptEntry) => {
    if (typeof e.seq === "number") bySeq.set(e.seq, e);
    else if (e.id) byId.set(e.id, e);
    else seqless.push(e);
  };
  for (const e of prev) add(e);
  for (const e of delta) add(e);
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
