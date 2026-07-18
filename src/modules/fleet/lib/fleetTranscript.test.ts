import { describe, expect, it } from "vitest";
import {
  type TranscriptEntry,
  maxSeq,
  mergeTranscript,
  normalizeTranscript,
  reconcileOptimistic,
  runningFloor,
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

describe("runningFloor — the cursor that lets a mutated-in-place entry settle", () => {
  it("equals maxSeq when nothing is running", () => {
    const entries = [
      e({ kind: "user", seq: 1, status: "ok" }),
      e({ kind: "assistant", seq: 2, status: "ok" }),
    ];
    expect(runningFloor(entries)).toBe(maxSeq(entries));
    expect(runningFloor(entries)).toBe(2);
  });

  it("equals 0 for an empty transcript", () => {
    expect(runningFloor([])).toBe(0);
  });

  it("holds one below the lowest running entry's seq", () => {
    const entries = [
      e({ kind: "assistant", seq: 1, status: "ok" }),
      e({ kind: "tool", seq: 5, status: "running" }),
      e({ kind: "assistant", seq: 6, status: "ok" }),
    ];
    expect(runningFloor(entries)).toBe(4);
  });

  it("does NOT let a kind:system pending-gate entry pin the floor", () => {
    const entries = [
      e({
        kind: "system",
        seq: 5,
        status: "running",
        pending: { requestId: "r1", action: "created" },
      }),
      e({ kind: "assistant", seq: 6, status: "ok" }),
    ];
    // The only "running" entry is the system gate — excluded — so the floor falls back to maxSeq.
    expect(runningFloor(entries)).toBe(6);
  });

  it("ignores a running system gate but still holds on a REAL running entry beside it", () => {
    const entries = [
      e({
        kind: "system",
        seq: 2,
        status: "running",
        pending: { requestId: "r1", action: "created" },
      }),
      e({ kind: "tool", seq: 5, status: "running" }),
      e({ kind: "assistant", seq: 6, status: "ok" }),
    ];
    // Floor tracks the tool at seq 5, not the system gate at seq 2.
    expect(runningFloor(entries)).toBe(4);
  });
});

describe("regression demo — the daemon mutates a streaming entry in place without bumping seq", () => {
  /** Mimics the daemon's real delta filter (src/transcript-delta.ts): strictly seq > since. Clones
   *  each entry — a real poll crosses an HTTP/JSON boundary, so the client never shares object
   *  identity with the daemon's in-memory `TranscriptEntry`; without this clone, mutating
   *  `server[i]` in the test would mutate the client's copy too, for a reason that has nothing to
   *  do with the cursor policy under test. */
  function serverDelta(serverEntries: TranscriptEntry[], since: number): TranscriptEntry[] {
    return serverEntries
      .filter((x) => (x.seq ?? 0) > since)
      .map((x) => structuredClone(x));
  }

  it("OLD cursor (maxSeq) leaves a mutated tool entry frozen forever", () => {
    // Poll 1: a tool call starts, arrives running at seq 1.
    const server: TranscriptEntry[] = [
      e({ kind: "tool", seq: 1, status: "running", text: "▸ read_file" }),
    ];
    let client = mergeTranscript([], serverDelta(server, 0));
    expect(client[0].status).toBe("running");

    const since = maxSeq(client); // old policy
    expect(since).toBe(1);

    // The daemon settles the SAME entry in place (Object.assign — no seq bump).
    server[0].status = "ok";
    server[0].text = "▸ read_file: done";

    // Poll 2: the daemon's strict seq > since filter excludes it — nothing comes back.
    const delta = serverDelta(server, since);
    expect(delta).toHaveLength(0); // regression: the mutation is invisible to this cursor

    client = mergeTranscript(client, delta);
    expect(client[0].status).toBe("running"); // frozen forever — the bug
  });

  it("NEW cursor (runningFloor) settles the same mutated tool entry", () => {
    const server: TranscriptEntry[] = [
      e({ kind: "tool", seq: 1, status: "running", text: "▸ read_file" }),
    ];
    let client = mergeTranscript([], serverDelta(server, 0));
    expect(client[0].status).toBe("running");

    const since = runningFloor(client); // new policy: floor one below the running entry's seq
    expect(since).toBe(0);

    server[0].status = "ok";
    server[0].text = "▸ read_file: done";

    // Poll 2: since=0 still admits seq=1, so the mutated entry is re-delivered.
    const delta = serverDelta(server, since);
    expect(delta).toHaveLength(1);

    client = mergeTranscript(client, delta);
    expect(client[0].status).toBe("ok"); // settled
    expect(client[0].text).toBe("▸ read_file: done");

    // And the cursor is now free to advance past it — nothing left running.
    expect(runningFloor(client)).toBe(1);
  });

  it("a kind:system pending-gate entry does not pin the floor while a real turn keeps advancing", () => {
    // A tool-needs-host gate is appended running at seq 3 and never mutates in place; a later,
    // unrelated assistant turn (seq 4) still needs to be pollable without the gate holding the
    // cursor back at seq 2 forever.
    let server: TranscriptEntry[] = [
      e({ kind: "user", seq: 1, status: undefined, text: "go" }),
      e({
        kind: "system",
        seq: 3,
        status: "running",
        text: "⛔ tool call needs host: bash",
        pending: { requestId: "r9", action: "created" },
      }),
    ];
    let client = mergeTranscript([], serverDelta(server, 0));
    const since1 = runningFloor(client);
    expect(since1).toBe(3); // NOT 2 — the system gate never pins the floor

    // A new assistant entry lands.
    server = [...server, e({ kind: "assistant", seq: 4, status: "ok", text: "done" })];
    const delta = serverDelta(server, since1);
    expect(delta.map((x) => x.seq)).toEqual([4]);
    client = mergeTranscript(client, delta);
    expect(client.map((x) => x.text)).toContain("done");
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

  it("preserves object IDENTITY for an unchanged re-delivered entry (running-floor re-polls it every tick — CSS pulse animations key on this reference and must not restart)", () => {
    const prevEntry = e({
      kind: "tool",
      seq: 1,
      status: "running",
      text: "▸ read_file",
      tool: { name: "read_file", callId: "c1" },
    });
    const prev = [prevEntry];

    // A structurally-identical (but NOT reference-identical) copy, exactly as JSON.parse of a
    // fresh HTTP response would produce, even though nothing about the entry actually changed.
    const unchangedCopy = e({
      kind: "tool",
      seq: 1,
      status: "running",
      text: "▸ read_file",
      tool: { name: "read_file", callId: "c1" },
    });

    const merged = mergeTranscript(prev, [unchangedCopy]);
    expect(merged[0]).toBe(prevEntry); // SAME reference — not unchangedCopy

    // Sanity: a genuinely different re-delivery of the same seq DOES replace the reference.
    const changedCopy = e({
      kind: "tool",
      seq: 1,
      status: "ok",
      text: "▸ read_file: done",
      tool: { name: "read_file", callId: "c1", resultText: "42 lines" },
    });
    const merged2 = mergeTranscript(merged, [changedCopy]);
    expect(merged2[0]).not.toBe(prevEntry);
    expect(merged2[0]).toBe(changedCopy);
    expect(merged2[0].status).toBe("ok");
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
