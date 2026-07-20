import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "../lib/fleetTranscript";
import { deriveTimelineRows, type TimelineRow } from "./deriveRows";
import { stabilizeRows } from "./stableRows";

function e(
  over: Partial<TranscriptEntry> & { kind: TranscriptEntry["kind"] },
): TranscriptEntry {
  return { text: "t", ts: 0, ...over };
}

describe("stabilizeRows — structural sharing across poll ticks (r3 borrow 5)", () => {
  it("returns the PREVIOUS ARRAY identity when nothing changed", () => {
    const entries = [
      e({ id: "u1", kind: "user", ts: 0 }),
      e({ id: "a1", kind: "assistant", ts: 1, status: "ok" }),
    ];
    const first = stabilizeRows([], deriveTimelineRows(entries));
    // Same entry OBJECTS (mergeTranscript's identity guarantee) → fresh derivation, same rows.
    const second = stabilizeRows(first, deriveTimelineRows(entries));
    expect(second).toBe(first);
  });

  it("reuses unchanged row objects when one row changes", () => {
    const user = e({ id: "u1", kind: "user", ts: 0 });
    const runningAssistant = e({ id: "a1", kind: "assistant", ts: 1, status: "running" });
    const first = stabilizeRows([], deriveTimelineRows([user, runningAssistant]));

    // Poll settles the assistant: the daemon delivers a NEW entry object (content changed).
    const settledAssistant = e({ id: "a1", kind: "assistant", ts: 1, status: "ok" });
    const second = stabilizeRows(first, deriveTimelineRows([user, settledAssistant]));

    expect(second).not.toBe(first);
    const firstUser = first.find((r) => r.kind === "message" && r.entry === user);
    const secondUser = second.find((r) => r.kind === "message" && r.entry === user);
    expect(secondUser).toBe(firstUser); // untouched row: SAME object
    const secondAssistant = second.find(
      (r): r is Extract<TimelineRow, { kind: "message" }> =>
        r.kind === "message" && r.id === "a1",
    );
    expect(secondAssistant?.entry).toBe(settledAssistant); // changed row: fresh object
  });

  it("a work row is reused only while its entry references and expansion are unchanged", () => {
    const entries = [
      e({ id: "u1", kind: "user", ts: 0 }),
      e({ id: "t1", kind: "tool", ts: 1, status: "ok", tool: { name: "read" } }),
      e({ id: "t2", kind: "tool", ts: 2, status: "ok", tool: { name: "read" } }),
    ];
    const collapsed = stabilizeRows([], deriveTimelineRows(entries));
    const expandedNext = deriveTimelineRows(entries, {
      expandedWorkGroups: new Set(collapsed.filter((r) => r.kind === "work").map((r) => r.id)),
    });
    const expanded = stabilizeRows(collapsed, expandedNext);
    const collapsedWork = collapsed.find((r) => r.kind === "work");
    const expandedWork = expanded.find((r) => r.kind === "work");
    expect(expandedWork).not.toBe(collapsedWork); // expansion flip → new object
  });

  it("a turn-fold row is reused while label/expanded/hidden ids match", () => {
    const entries = [
      e({ id: "u1", kind: "user", ts: 0 }),
      e({ id: "th1", kind: "thinking", ts: 1, status: "ok" }),
      e({ id: "a1", kind: "assistant", ts: 2, status: "ok" }),
      e({ id: "u2", kind: "user", ts: 10_000 }),
      e({ id: "a2", kind: "assistant", ts: 11_000, status: "ok" }),
    ];
    const first = stabilizeRows([], deriveTimelineRows(entries));
    const second = stabilizeRows(first, deriveTimelineRows(entries));
    expect(second).toBe(first);
    const fold = first.find((r) => r.kind === "turn-fold");
    expect(fold).toBeDefined();
  });

  it("first render (empty prev) passes the fresh array through untouched", () => {
    const next = deriveTimelineRows([e({ id: "u1", kind: "user", ts: 0 })]);
    expect(stabilizeRows([], next)).toBe(next);
  });
});
