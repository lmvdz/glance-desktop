import { describe, expect, it } from "vitest";
import { attentionTransitions, isAttention } from "./fleetAttention";
import type { LadderPriority } from "./fleetLadder";
import type { FleetStatus, FleetUnit } from "./fleetRoster";

function unit(
  id: string,
  status: FleetStatus,
  priority: LadderPriority | undefined,
  over: Partial<FleetUnit> = {},
): FleetUnit {
  return {
    id,
    name: id,
    repo: "/r",
    daemonId: "d1",
    status,
    ladderPriority: priority,
    ...over,
  };
}

describe("isAttention — reads the daemon's server tier, not raw status", () => {
  it("is true only for the needs-you tiers (error / pending-approval / awaiting-input)", () => {
    for (const p of [
      "error",
      "pending-approval",
      "awaiting-input",
    ] as LadderPriority[]) {
      expect(isAttention(unit("x", "input", p))).toBe(true);
    }
    for (const p of [
      "working",
      "plan-ready",
      "completed-unseen",
      "idle",
    ] as LadderPriority[]) {
      expect(isAttention(unit("x", "working", p))).toBe(false);
    }
  });
});

describe("attentionTransitions — fire once on entry, collapse while blocked", () => {
  it("alerts a unit that JUST entered attention", () => {
    const prev = [unit("a", "working", "working")];
    const next = [
      unit("a", "input", "awaiting-input", {
        pending: [{ id: "p", title: "Approve?" }],
      }),
    ];
    const { alerts, notified } = attentionTransitions(prev, next, new Set());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      unitId: "a",
      daemonId: "d1",
      body: "Approve?",
    });
    expect(alerts[0].title).toContain("needs you");
    expect(notified.has("d1:a")).toBe(true);
  });

  it("does NOT re-alert a unit that was already in attention (prev snapshot)", () => {
    const prev = [unit("a", "input", "awaiting-input")];
    const next = [unit("a", "input", "awaiting-input")];
    expect(attentionTransitions(prev, next, new Set()).alerts).toHaveLength(0);
  });

  it("does NOT re-alert a unit already in the notified set (collapse across polls)", () => {
    const next = [unit("a", "error", "error")];
    const { alerts } = attentionTransitions([], next, new Set(["d1:a"]));
    expect(alerts).toHaveLength(0);
  });

  it("re-alerts after recovery: leaving attention clears the collapse, re-entry fires again", () => {
    const cleared = attentionTransitions(
      [unit("a", "input", "awaiting-input")],
      [unit("a", "idle", "idle")],
      new Set(["d1:a"]),
    );
    expect(cleared.notified.has("d1:a")).toBe(false);
    const reentry = attentionTransitions(
      [unit("a", "idle", "idle")],
      [unit("a", "input", "awaiting-input")],
      cleared.notified,
    );
    expect(reentry.alerts.map((x) => x.unitId)).toEqual(["a"]);
  });

  it("error alerts carry the error text; a new error unit and a new input unit both fire", () => {
    const next = [
      unit("boom", "error", "error", { error: "child crashed" }),
      unit("ask", "input", "pending-approval", {
        pending: [{ id: "p", title: "Confirm delete?" }],
      }),
    ];
    const { alerts } = attentionTransitions([], next, new Set());
    expect(alerts).toHaveLength(2);
    expect(alerts.find((a) => a.unitId === "boom")?.body).toBe("child crashed");
    expect(alerts.find((a) => a.unitId === "boom")?.title).toContain("errored");
  });

  it("the SAME unit id on two different daemons is tracked independently (M02)", () => {
    const prev = [unit("1", "input", "awaiting-input", { daemonId: "laptop" })];
    const next = [
      unit("1", "input", "awaiting-input", { daemonId: "laptop" }),
      unit("1", "input", "awaiting-input", { daemonId: "workstation" }),
    ];
    const { alerts, notified } = attentionTransitions(
      prev,
      next,
      new Set(["laptop:1"]),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ unitId: "1", daemonId: "workstation" });
    expect(notified.has("laptop:1")).toBe(true);
    expect(notified.has("workstation:1")).toBe(true);
  });
});
