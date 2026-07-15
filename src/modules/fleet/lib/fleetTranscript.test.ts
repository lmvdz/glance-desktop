import { describe, expect, it } from "vitest";
import {
  type TranscriptEntry,
  maxSeq,
  mergeTranscript,
  normalizeTranscript,
  reconcileOptimistic,
} from "./fleetTranscript";

function e(
  over: Partial<TranscriptEntry> & { kind: TranscriptEntry["kind"] },
): TranscriptEntry {
  return { text: "t", ts: 0, ...over };
}

describe("maxSeq — the delta poll cursor", () => {
  it("is the highest seq, or 0 when none carry one", () => {
    expect(
      maxSeq([e({ kind: "user", seq: 3 }), e({ kind: "assistant", seq: 7 })]),
    ).toBe(7);
    expect(maxSeq([e({ kind: "user" })])).toBe(0);
    expect(maxSeq([])).toBe(0);
  });
});

describe("mergeTranscript — accumulate delta batches, ordered + deduped", () => {
  it("appends new entries and orders by seq", () => {
    const merged = mergeTranscript(
      [e({ kind: "user", seq: 1, text: "a" })],
      [
        e({ kind: "assistant", seq: 2, text: "b" }),
        e({ kind: "assistant", seq: 3, text: "c" }),
      ],
    );
    expect(merged.map((x) => x.text)).toEqual(["a", "b", "c"]);
  });

  it("de-dupes on seq — a re-delivered entry never doubles", () => {
    const merged = mergeTranscript(
      [e({ kind: "user", seq: 1, text: "a" })],
      [
        e({ kind: "user", seq: 1, text: "a" }),
        e({ kind: "assistant", seq: 2, text: "b" }),
      ],
    );
    expect(merged.map((x) => x.text)).toEqual(["a", "b"]);
  });

  it("keeps seq-less optimistic entries at the tail, deduped by id", () => {
    const merged = mergeTranscript(
      [e({ kind: "assistant", seq: 5, text: "srv" })],
      [e({ kind: "user", text: "typed", clientTurnId: "c1" })],
    );
    expect(merged.map((x) => x.text)).toEqual(["srv", "typed"]);
  });
});

describe("reconcileOptimistic — drop the placeholder once the server echoes it", () => {
  it("removes a seq-less optimistic turn when a seq'd entry shares its clientTurnId", () => {
    const list = [
      e({ kind: "user", text: "hi", clientTurnId: "c1" }), // optimistic, no seq
      e({ kind: "user", seq: 4, text: "hi", clientTurnId: "c1" }), // server echo, with seq
    ];
    const out = reconcileOptimistic(list);
    expect(out).toHaveLength(1);
    expect(out[0].seq).toBe(4);
  });

  it("keeps an optimistic turn that has NOT been echoed yet", () => {
    const list = [e({ kind: "user", text: "pending", clientTurnId: "c2" })];
    expect(reconcileOptimistic(list)).toHaveLength(1);
  });
});

describe("normalizeTranscript — untrusted payload", () => {
  it("keeps well-formed entries, drops junk", () => {
    const raw = [
      { kind: "user", text: "ok", ts: 1 },
      { kind: "user" },
      null,
      "x",
    ];
    expect(normalizeTranscript(raw).map((x) => x.text)).toEqual(["ok"]);
    expect(normalizeTranscript({ error: "x" })).toEqual([]);
  });
});
