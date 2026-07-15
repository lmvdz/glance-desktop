// Daemon-backed chat (fleet-ide-escalation E01) — pure mapping from a daemon unit's transcript
// deltas to AI-SDK UIMessage stream chunks. The daemon streams WHOLE, growing transcript entries
// (not token deltas), so this reducer remembers how much of each entry it has already emitted and
// writes only the appended suffix as a text/reasoning delta. Kept pure + separate from the poller
// (daemonTransport.ts) so the diffing is unit-testable.

import type { UIMessage } from "@ai-sdk/react";
import type { UIMessageChunk } from "ai";
import type { TranscriptEntry } from "@/modules/fleet/lib/fleetTranscript";

/** The text of the latest user message — the turn we steer into the daemon unit. */
export function latestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const parts = m.parts as ReadonlyArray<{ type: string; text?: string }>;
    return parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("")
      .trim();
  }
  return "";
}

type BlockKind = "text" | "reasoning";

interface Block {
  kind: BlockKind;
  /** How many chars of this entry's text we've already streamed. */
  emitted: number;
  /** The stream-part id (stable per transcript entry). */
  id: string;
}

export interface StreamState {
  /** entry key (seq/id) → open block. */
  blocks: Map<string, Block>;
  /** open block keys in first-seen order, for deterministic finalize. */
  order: string[];
}

export function initStreamState(): StreamState {
  return { blocks: new Map(), order: [] };
}

/** A stable per-entry key: prefer the monotonic seq, else the id. Seq-less/id-less entries can't be
 *  delta-diffed safely (no identity across polls), so they're skipped. */
function keyOf(e: TranscriptEntry): string | null {
  if (typeof e.seq === "number") return `s${e.seq}`;
  if (e.id) return `i${e.id}`;
  return null;
}

/** Which stream block an entry maps to. Only assistant + thinking reach the chat bubble; user echoes,
 *  tool steps and system entries are not streamed here (they remain visible in the intervene pane's
 *  full transcript). Tool rendering in the chat surface is a deliberate v1 deferral. */
function blockKind(e: TranscriptEntry): BlockKind | null {
  if (e.kind === "assistant") return "text";
  if (e.kind === "thinking") return "reasoning";
  return null;
}

/** Fold a delta batch of transcript entries into UI stream chunks, emitting only newly-appended text
 *  per entry. Returns the chunks to write and the advanced state. Pure. */
export function stepStream(
  state: StreamState,
  delta: TranscriptEntry[],
): { chunks: UIMessageChunk[]; state: StreamState } {
  const chunks: UIMessageChunk[] = [];
  const blocks = new Map(state.blocks);
  const order = state.order.slice();

  for (const e of delta) {
    const kind = blockKind(e);
    if (!kind) continue;
    const k = keyOf(e);
    if (!k) continue;

    let b = blocks.get(k);
    if (!b) {
      b = { kind, emitted: 0, id: k };
      blocks.set(k, b);
      order.push(k);
      chunks.push(
        kind === "text"
          ? { type: "text-start", id: k }
          : { type: "reasoning-start", id: k },
      );
    }
    const full = e.text ?? "";
    if (full.length > b.emitted) {
      const deltaText = full.slice(b.emitted);
      chunks.push(
        b.kind === "text"
          ? { type: "text-delta", id: b.id, delta: deltaText }
          : { type: "reasoning-delta", id: b.id, delta: deltaText },
      );
      blocks.set(k, { ...b, emitted: full.length });
    }
  }
  return { chunks, state: { blocks, order } };
}

/** Close every open block (text-end/reasoning-end), in first-seen order. Pure. */
export function finalizeStream(state: StreamState): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [];
  for (const k of state.order) {
    const b = state.blocks.get(k);
    if (!b) continue;
    chunks.push(
      b.kind === "text"
        ? { type: "text-end", id: b.id }
        : { type: "reasoning-end", id: b.id },
    );
  }
  return chunks;
}
