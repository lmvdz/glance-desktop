import { describe, expect, it } from "vitest";
import type { FleetStatus, FleetUnit } from "../../lib/fleetRoster";
import {
  humanizeReason,
  isConsoleThread,
  rowDuration,
  rowReason,
  stateSince,
  threadTitle,
} from "./spineReason";

function unit(over: Partial<FleetUnit> & { status: FleetStatus }): FleetUnit {
  return { id: "u1", name: "unit-1", repo: "/r", daemonId: "d1", ...over };
}

describe("isConsoleThread — mirrors the daemon's own console identity (minus the wire-absent prompt)", () => {
  it("is a thread for an omp-operator unit named 'chat' that isn't promoted", () => {
    expect(
      isConsoleThread({ kind: "omp-operator", name: "chat", promoted: false }),
    ).toBe(true);
    expect(
      isConsoleThread({
        kind: "omp-operator",
        name: "chat",
        promoted: undefined,
      }),
    ).toBe(true);
  });

  it("a PROMOTED chat is a work unit, not a thread", () => {
    expect(
      isConsoleThread({ kind: "omp-operator", name: "chat", promoted: true }),
    ).toBe(false);
  });

  it("a real work unit (other kind / other name) is never a thread", () => {
    expect(
      isConsoleThread({ kind: "workflow", name: "chat", promoted: false }),
    ).toBe(false);
    expect(
      isConsoleThread({
        kind: "omp-operator",
        name: "fix-the-bug",
        promoted: false,
      }),
    ).toBe(false);
    expect(
      isConsoleThread({ kind: undefined, name: "chat", promoted: false }),
    ).toBe(false);
  });

  it("titles a thread 'New thread' (the daemon's 'chat' name is meaningless in a list)", () => {
    expect(threadTitle()).toBe("New thread");
  });
});

describe("humanizeReason — no raw internal token ever reaches the spine", () => {
  it("maps a bare workflow node id to an operator phrase (the user's literal 'escalate')", () => {
    expect(humanizeReason("escalate")).toBe("Escalating to you");
    expect(humanizeReason("Escalate")).toBe("Escalating to you");
    expect(humanizeReason("fixup")).toBe("Fixing up the change");
  });

  it("strips an internal GATE:/gate_ prefix before mapping/showing", () => {
    expect(humanizeReason("GATE: escalate")).toBe("Escalating to you");
    expect(humanizeReason("gate_approve the budget")).toBe("approve the budget");
  });

  it("passes a genuine question/error through — only its first line, trimmed", () => {
    expect(humanizeReason("  Should I force-push to main?  ")).toBe(
      "Should I force-push to main?",
    );
    expect(humanizeReason("TypeError: cannot read x\n  at foo (bar.ts:1)")).toBe(
      "TypeError: cannot read x",
    );
  });
});

describe("rowReason — WHY a needs-you/plan-ready row wants a human", () => {
  it("shows the pending question for awaiting-input / pending-approval", () => {
    expect(
      rowReason(
        unit({
          status: "input",
          ladderPriority: "awaiting-input",
          pending: [{ id: "p1", title: "Which region should I deploy to?" }],
        }),
      ),
    ).toBe("Which region should I deploy to?");
    expect(
      rowReason(
        unit({
          status: "input",
          ladderPriority: "pending-approval",
          pending: [{ id: "p1", title: "Run `rm -rf build`?" }],
        }),
      ),
    ).toBe("Run `rm -rf build`?");
  });

  it("shows the error's first line for the error tier, humanized", () => {
    expect(
      rowReason(
        unit({
          status: "error",
          ladderPriority: "error",
          error: "Command failed: exit 1\n  stack trace…",
        }),
      ),
    ).toBe("Command failed: exit 1");
    // A workflow that stalled at its 'escalate' node must not surface the raw node id.
    expect(
      rowReason(
        unit({
          status: "input",
          ladderPriority: "pending-approval",
          pending: [{ id: "p1", title: "escalate" }],
        }),
      ),
    ).toBe("Escalating to you");
  });

  it("reads 'Ready to land' for plan-ready, and nothing for working/idle", () => {
    expect(rowReason(unit({ status: "idle", ladderPriority: "plan-ready" }))).toBe(
      "Ready to land",
    );
    expect(rowReason(unit({ status: "working", ladderPriority: "working" }))).toBe(
      null,
    );
    expect(rowReason(unit({ status: "idle", ladderPriority: "idle" }))).toBe(null);
  });
});

describe("stateSince / rowDuration — time in the CURRENT state, never spawn age", () => {
  const now = 1_000_000_000;

  it("anchors on the most recent transition INTO the current status", () => {
    const u = unit({
      status: "input",
      ladderPriority: "awaiting-input",
      transitions: [
        { to: "working", at: now - 5 * 60_000 },
        { to: "input", at: now - 12 * 60_000 }, // an earlier wait
        { to: "working", at: now - 3 * 60_000 },
        { to: "input", at: now - 2 * 60_000 }, // the CURRENT wait
      ],
    });
    expect(stateSince(u)).toBe(now - 2 * 60_000);
    expect(rowDuration(u, now)).toBe("Waiting on you for 2m");
  });

  it("never uses spawn age: a 50h-old unit working for 3m reads 'Working for 3m'", () => {
    const u = unit({
      status: "working",
      ladderPriority: "working",
      startedAt: now - 50 * 3_600_000, // spawned 50h ago — the tempting lie
      transitions: [{ to: "working", at: now - 3 * 60_000 }],
    });
    expect(rowDuration(u, now)).toBe("Working for 3m");
  });

  it("phrases the error tier as 'Blocked for …'", () => {
    const u = unit({
      status: "error",
      ladderPriority: "error",
      error: "boom",
      transitions: [{ to: "error", at: now - 90_000 }],
    });
    expect(rowDuration(u, now)).toBe("Blocked for 1m 30s");
  });

  it("shows NO duration rather than fabricate one when the wire lacks a matching transition", () => {
    expect(
      rowDuration(unit({ status: "working", ladderPriority: "working" }), now),
    ).toBe(null);
    expect(
      stateSince(
        unit({
          status: "input",
          ladderPriority: "awaiting-input",
          transitions: [{ to: "working", at: now - 1000 }],
        }),
      ),
    ).toBe(undefined);
  });

  it("returns null duration for tiers with no meaningful clock (idle / plan-ready)", () => {
    const u = unit({
      status: "idle",
      ladderPriority: "plan-ready",
      transitions: [{ to: "idle", at: now - 60_000 }],
    });
    expect(rowDuration(u, now)).toBe(null);
  });
});
