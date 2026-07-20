import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "../lib/fleetTranscript";
import {
  MAX_VISIBLE_WORK_LOG_ENTRIES,
  deriveMinimapDots,
  deriveTimelineRows,
  isDelegationEntry,
  formatDuration,
  type TimelineRow,
  workingForLabel,
} from "./deriveRows";

function e(
  over: Partial<TranscriptEntry> & { kind: TranscriptEntry["kind"] },
): TranscriptEntry {
  return { text: "t", ts: 0, ...over };
}

function kinds(rows: TimelineRow[]): string[] {
  return rows.map((r) => r.kind);
}

describe("formatDuration", () => {
  it("renders sub-minute as seconds", () => {
    expect(formatDuration(4200)).toBe("4s");
    expect(formatDuration(0)).toBe("0s");
  });
  it("renders minutes, dropping the seconds component when zero", () => {
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(120_000)).toBe("2m");
  });
  it("renders hours", () => {
    expect(formatDuration(3_661_000)).toBe("1h 1m");
    expect(formatDuration(3_600_000)).toBe("1h");
  });
});

describe("workingForLabel — the live working timer (t3 voice)", () => {
  it("phrases elapsed time as 'Working for Xm Ys', not raw seconds", () => {
    expect(workingForLabel(134_000)).toBe("Working for 2m 14s");
    expect(workingForLabel(45_000)).toBe("Working for 45s");
    expect(workingForLabel(120_000)).toBe("Working for 2m");
  });
  it("never shows a negative clock for a startedAt in the future (clock skew)", () => {
    expect(workingForLabel(-5_000)).toBe("Working for 0s");
  });
});

describe("turn-fold derivation — finished turns collapse, latest stays expanded", () => {
  it("folds a completed first turn once a second turn starts, and never folds the latest turn", () => {
    const entries: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "do the thing" }),
      e({ id: "t1", kind: "tool", ts: 500, status: "ok", tool: { name: "read_file" } }),
      e({ id: "a1", kind: "assistant", ts: 2_000, status: "ok", text: "done with the thing" }),
      e({ id: "u2", kind: "user", ts: 3_000, text: "now do another thing" }),
      e({ id: "t2", kind: "tool", ts: 4_000, status: "running", tool: { name: "bash_run" } }),
    ];

    const rows = deriveTimelineRows(entries);

    // Turn 0: user message stays visible, then a fold row (tool+assistant hidden behind it), no
    // separate work/message rows for the folded content since it isn't expanded.
    expect(rows[0]).toMatchObject({ kind: "message", entry: { id: "u1" } });
    expect(rows[1]).toMatchObject({ kind: "turn-fold", expanded: false, turnIndex: 0 });
    expect((rows[1] as Extract<TimelineRow, { kind: "turn-fold" }>).label).toBe("Worked for 2s");
    // The turn's terminal assistant message stays visible below the fold even collapsed.
    expect(rows[2]).toMatchObject({ kind: "message", entry: { id: "a1" } });

    // Turn 1 (the latest) is NOT folded — its user message and running tool render flat.
    expect(rows[3]).toMatchObject({ kind: "message", entry: { id: "u2" } });
    expect(rows[4]).toMatchObject({ kind: "work" });
    expect((rows[4] as Extract<TimelineRow, { kind: "work" }>).visible[0].id).toBe("t2");

    // A live "working" row appears because the latest turn has a running tool call.
    const working = rows.find((r) => r.kind === "working");
    expect(working).toBeDefined();
    expect((working as Extract<TimelineRow, { kind: "working" }>).startedAt).toBe(4_000);
  });

  it("expands a folded turn's hidden entries when its turnFold id is in expandedTurns", () => {
    const entries: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 500, status: "ok", tool: { name: "read_file" } }),
      e({ id: "a1", kind: "assistant", ts: 2_000, status: "ok", text: "done" }),
      e({ id: "u2", kind: "user", ts: 3_000, text: "next" }),
    ];
    const rows = deriveTimelineRows(entries, { expandedTurns: new Set(["turn-fold:0"]) });
    expect(kinds(rows)).toEqual(["message", "turn-fold", "work", "message", "message"]);
    expect((rows[1] as Extract<TimelineRow, { kind: "turn-fold" }>).expanded).toBe(true);
  });

  it("skips the fold row entirely when a turn has nothing to hide (steer superseded before any response)", () => {
    const entries: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "u2", kind: "user", ts: 1, text: "changed my mind" }),
    ];
    const rows = deriveTimelineRows(entries);
    expect(kinds(rows)).toEqual(["message", "message"]);
  });

  it("labels a turn superseded mid-flight as steer-interrupted", () => {
    const entries: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 1, status: "running", tool: { name: "bash_run" } }),
      e({ id: "a1", kind: "assistant", ts: 65_000, status: "running", text: "working on it" }),
      e({ id: "u2", kind: "user", ts: 66_000, text: "stop, do this instead" }),
    ];
    const rows = deriveTimelineRows(entries);
    const fold = rows.find((r) => r.kind === "turn-fold") as Extract<
      TimelineRow,
      { kind: "turn-fold" }
    >;
    expect(fold.label).toBe("You stopped after 1m 6s");
  });
});

describe("anti-flicker guard — folding must not flicker through the settle window", () => {
  // t3's own comment: "right after the user sends a message, the previous turn is still the
  // 'active' one ... and folding must not flicker through that window." Ported invariant: fold
  // state is driven by array position (last vs not), which only ever moves forward — never by a
  // transient `status` snapshot. We replay a sequence of poll snapshots and assert `expanded`
  // never toggles back to true for a superseded turn, and the turn-fold row's id never changes
  // (so React never remounts it), even as the superseded turn's entries later settle.
  it("does not re-expand a superseded turn as its trailing entries settle, and keeps a stable row id", () => {
    const base: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 1_000, status: "running", tool: { name: "bash_run" } }),
    ];
    const superseded: TranscriptEntry[] = [
      ...base,
      e({ id: "u2", kind: "user", ts: 5_000, text: "steer: stop and do X" }),
    ];

    // Snapshot A: t1 still running when superseded.
    const rowsA = deriveTimelineRows(superseded);
    const foldA = rowsA.find((r) => r.kind === "turn-fold") as Extract<
      TimelineRow,
      { kind: "turn-fold" }
    >;
    expect(foldA.expanded).toBe(false);
    expect(foldA.id).toBe("turn-fold:0");
    expect(foldA.label).toBe("You stopped after 5s");

    // Snapshot B: the daemon finally reports t1 settled as CANCELLED (the status a steer/interrupt
    // leaves behind) — mimics runningFloor eventually re-delivering the mutated-in-place entry. The
    // fold must NOT have re-expanded at any point, its id is unchanged (same row, not a remount),
    // and — because "cancelled" still counts as "not cleanly resolved" — the label stays IDENTICAL
    // across the whole settle window: it never flickered even transiently.
    const settled: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 1_000, status: "cancelled", tool: { name: "bash_run" } }),
      e({ id: "u2", kind: "user", ts: 5_000, text: "steer: stop and do X" }),
    ];
    const rowsB = deriveTimelineRows(settled);
    const foldB = rowsB.find((r) => r.kind === "turn-fold") as Extract<
      TimelineRow,
      { kind: "turn-fold" }
    >;
    expect(foldB.expanded).toBe(false); // never flipped true
    expect(foldB.id).toBe(foldA.id); // same row identity across the settle window
    expect(foldB.label).toBe(foldA.label); // identical label — zero flicker, not just "eventually correct"
    expect(foldB.label).toBe("You stopped after 5s");
  });

  it("DOES relabel from stopped to worked when an abandoned entry finally resolves cleanly (ok) — a legitimate one-time correction, not flicker, since it only ever moves in one direction", () => {
    const interrupted: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 1_000, status: "running", tool: { name: "bash_run" } }),
      e({ id: "u2", kind: "user", ts: 5_000, text: "steer: stop and do X" }),
    ];
    const foldWhileRunning = deriveTimelineRows(interrupted).find(
      (r) => r.kind === "turn-fold",
    ) as Extract<TimelineRow, { kind: "turn-fold" }>;
    expect(foldWhileRunning.label).toBe("You stopped after 5s");

    // The abandoned tool call actually finishes successfully server-side after being superseded.
    const resolvedOk: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 1_000, status: "ok", tool: { name: "bash_run" } }),
      e({ id: "u2", kind: "user", ts: 5_000, text: "steer: stop and do X" }),
    ];
    const foldResolved = deriveTimelineRows(resolvedOk).find(
      (r) => r.kind === "turn-fold",
    ) as Extract<TimelineRow, { kind: "turn-fold" }>;
    expect(foldResolved.id).toBe(foldWhileRunning.id);
    expect(foldResolved.label).toBe("Worked for 1s");
  });

  it("never folds the active (last) turn while it transitions through running -> ok", () => {
    const running: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 1, status: "running", tool: { name: "bash_run" } }),
    ];
    const ok: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 1, status: "ok", tool: { name: "bash_run" } }),
    ];
    for (const snapshot of [running, ok]) {
      const rows = deriveTimelineRows(snapshot);
      expect(rows.some((r) => r.kind === "turn-fold")).toBe(false);
    }
  });
});

describe("work grouping — only the last MAX_VISIBLE_WORK_LOG_ENTRIES tool call shown, rest behind a toggle", () => {
  it("collapses a run of tool calls into one work row with a hidden count when the run exceeds the max", () => {
    expect(MAX_VISIBLE_WORK_LOG_ENTRIES).toBe(1);
    const entries: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 1, status: "ok", tool: { name: "read_file" } }),
      e({ id: "t2", kind: "tool", ts: 2, status: "ok", tool: { name: "grep" } }),
      e({ id: "t3", kind: "tool", ts: 3, status: "running", tool: { name: "bash_run" } }),
    ];
    const rows = deriveTimelineRows(entries);
    const work = rows.find((r) => r.kind === "work") as Extract<TimelineRow, { kind: "work" }>;
    expect(work.visible.map((e) => e.id)).toEqual(["t3"]);
    expect(work.hidden.map((e) => e.id)).toEqual(["t1", "t2"]);
    expect(work.expanded).toBe(false);
  });

  it("expands the hidden run when its groupId is in expandedWorkGroups", () => {
    const entries: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 1, status: "ok", tool: { name: "read_file" } }),
      e({ id: "t2", kind: "tool", ts: 2, status: "ok", tool: { name: "grep" } }),
    ];
    const rowsCollapsed = deriveTimelineRows(entries);
    const work0 = rowsCollapsed.find((r) => r.kind === "work") as Extract<
      TimelineRow,
      { kind: "work" }
    >;
    const rowsExpanded = deriveTimelineRows(entries, {
      expandedWorkGroups: new Set([work0.groupId]),
    });
    const work1 = rowsExpanded.find((r) => r.kind === "work") as Extract<
      TimelineRow,
      { kind: "work" }
    >;
    expect(work1.expanded).toBe(true);
    expect(work1.hidden.map((e) => e.id)).toEqual(["t1"]);
    expect(work1.visible.map((e) => e.id)).toEqual(["t2"]);
  });

  it("does not merge tool runs across an assistant message", () => {
    const entries: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", ts: 0, text: "go" }),
      e({ id: "t1", kind: "tool", ts: 1, status: "ok", tool: { name: "read_file" } }),
      e({ id: "a1", kind: "assistant", ts: 2, status: "running", text: "checking..." }),
      e({ id: "t2", kind: "tool", ts: 3, status: "running", tool: { name: "grep" } }),
    ];
    const rows = deriveTimelineRows(entries);
    const workRows = rows.filter((r) => r.kind === "work") as Extract<
      TimelineRow,
      { kind: "work" }
    >[];
    expect(workRows).toHaveLength(2);
    expect(workRows[0].visible.map((e) => e.id)).toEqual(["t1"]);
    expect(workRows[1].visible.map((e) => e.id)).toEqual(["t2"]);
  });
});

describe("graceful flat-list fallback — a harness that never emits kind:\"user\" boundaries", () => {
  it("renders every entry flat, with no turn-fold rows and no crash", () => {
    const entries: TranscriptEntry[] = [
      e({ id: "s1", kind: "system", ts: 0, text: "session started" }),
      e({ id: "th1", kind: "thinking", ts: 1, text: "reasoning..." }),
      e({ id: "t1", kind: "tool", ts: 2, status: "ok", tool: { name: "read_file" } }),
      e({ id: "a1", kind: "assistant", ts: 3, status: "ok", text: "here you go" }),
    ];
    expect(() => deriveTimelineRows(entries)).not.toThrow();
    const rows = deriveTimelineRows(entries);
    expect(rows.some((r) => r.kind === "turn-fold")).toBe(false);
    expect(kinds(rows)).toEqual(["message", "message", "work", "message"]);
  });

  it("still surfaces a working row when the (only) group has a running entry", () => {
    const entries: TranscriptEntry[] = [
      e({ id: "a1", kind: "assistant", ts: 0, status: "running", text: "..." }),
    ];
    const rows = deriveTimelineRows(entries);
    expect(rows.some((r) => r.kind === "working")).toBe(true);
  });

  it("returns an empty row list for an empty transcript, without throwing", () => {
    expect(deriveTimelineRows([])).toEqual([]);
  });
});

describe("deriveMinimapDots — positioned by array index, not seq", () => {
  it("one dot per user entry, indexed by array position", () => {
    const entries: TranscriptEntry[] = [
      e({ id: "u1", kind: "user", seq: 1, ts: 0 }),
      e({ id: "t1", kind: "tool", seq: 40, ts: 1, status: "ok" }), // seq gap — manager-global
      e({ id: "u2", kind: "user", seq: 41, ts: 2 }),
    ];
    expect(deriveMinimapDots(entries)).toEqual([
      { id: "u1", arrayIndex: 0 },
      { id: "u2", arrayIndex: 2 },
    ]);
  });

  it("is empty when there are no user entries", () => {
    expect(deriveMinimapDots([e({ kind: "assistant", ts: 0 })])).toEqual([]);
  });
});

describe("delegation entries break work-run collapsing (r3 borrow 2)", () => {
  const del = (id: string, name = "task") =>
    e({ id, kind: "tool", ts: 1, status: "ok", tool: { name } });
  const t = (id: string) =>
    e({ id, kind: "tool", ts: 1, status: "ok", tool: { name: "read" } });

  it("a task call in the middle of a tool run gets its own always-visible row", () => {
    const entries = [e({ id: "u", kind: "user", ts: 0 }), t("t1"), t("t2"), del("d1"), t("t3")];
    const rows = deriveTimelineRows(entries);
    const work = rows.filter((r): r is Extract<TimelineRow, { kind: "work" }> => r.kind === "work");
    // three runs: [t1,t2] (collapsed to 1 visible + 1 hidden), [d1] alone, [t3]
    expect(work).toHaveLength(3);
    expect(work[0].hidden.map((x) => x.id)).toEqual(["t1"]);
    expect(work[0].visible.map((x) => x.id)).toEqual(["t2"]);
    expect(work[1].visible.map((x) => x.id)).toEqual(["d1"]);
    expect(work[1].hidden).toEqual([]);
    expect(work[1].expanded).toBe(true);
    expect(work[2].visible.map((x) => x.id)).toEqual(["t3"]);
  });

  it("a long run of delegations never collapses behind +N", () => {
    const entries = [e({ id: "u", kind: "user", ts: 0 }), del("d1"), del("d2", "agent"), del("d3", "workflow")];
    const rows = deriveTimelineRows(entries);
    const work = rows.filter((r): r is Extract<TimelineRow, { kind: "work" }> => r.kind === "work");
    expect(work).toHaveLength(3);
    for (const w of work) expect(w.hidden).toEqual([]);
  });

  it("isDelegationEntry keys off the tool name, case-insensitively, and never non-tools", () => {
    expect(isDelegationEntry(del("x", "Task"))).toBe(true);
    expect(isDelegationEntry(t("y"))).toBe(false);
    expect(isDelegationEntry(e({ kind: "assistant", ts: 0 }))).toBe(false);
  });
});
