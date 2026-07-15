import { describe, expect, it } from "vitest";
import type { FleetStatus, FleetUnit } from "./fleetRoster";
import { attentionTransitions, isAttention } from "./fleetAttention";

function unit(
  id: string,
  status: FleetStatus,
  over: Partial<FleetUnit> = {},
): FleetUnit {
  return { id, name: id, repo: "/r", daemonId: "d1", status, ...over };
}

describe("isAttention", () => {
  it("is true only for input and error", () => {
    expect(isAttention({ status: "input" })).toBe(true);
    expect(isAttention({ status: "error" })).toBe(true);
    for (const s of [
      "working",
      "idle",
      "starting",
      "stopped",
    ] as FleetStatus[]) {
      expect(isAttention({ status: s })).toBe(false);
    }
  });
});

describe("attentionTransitions — fire once on entry, collapse while blocked", () => {
  it("alerts a unit that JUST entered attention", () => {
    const prev = [unit("a", "working")];
    const next = [
      unit("a", "input", { pending: [{ id: "p", title: "Approve?" }] }),
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
    const prev = [unit("a", "input")];
    const next = [unit("a", "input")];
    expect(attentionTransitions(prev, next, new Set()).alerts).toHaveLength(0);
  });

  it("does NOT re-alert a unit already in the notified set (collapse across polls)", () => {
    const next = [unit("a", "error")];
    // prev also shows it as error would suppress; use prev without it but notified set has it
    const { alerts } = attentionTransitions([], next, new Set(["d1:a"]));
    expect(alerts).toHaveLength(0);
  });

  it("re-alerts after recovery: leaving attention clears the collapse, re-entry fires again", () => {
    // was notified while blocked; now idle → drops from the set
    const cleared = attentionTransitions(
      [unit("a", "input")],
      [unit("a", "idle")],
      new Set(["d1:a"]),
    );
    expect(cleared.notified.has("d1:a")).toBe(false);
    // later re-enters attention from idle → alerts again
    const reentry = attentionTransitions(
      [unit("a", "idle")],
      [unit("a", "input")],
      cleared.notified,
    );
    expect(reentry.alerts.map((x) => x.unitId)).toEqual(["a"]);
  });

  it("error alerts carry the error text; a new error unit and a new input unit both fire", () => {
    const next = [
      unit("boom", "error", { error: "child crashed" }),
      unit("ask", "input", {
        pending: [{ id: "p", title: "Confirm delete?" }],
      }),
    ];
    const { alerts } = attentionTransitions([], next, new Set());
    expect(alerts).toHaveLength(2);
    expect(alerts.find((a) => a.unitId === "boom")?.body).toBe("child crashed");
    expect(alerts.find((a) => a.unitId === "boom")?.title).toContain("errored");
  });

  it("the SAME unit id on two different daemons is tracked independently (M02)", () => {
    // Both daemons happen to name their unit "1" — a real collision. Daemon A's unit is already
    // blocked (collapsed); daemon B's same-id unit JUST entered attention and must still alert.
    const prev = [unit("1", "input", { daemonId: "laptop" })];
    const next = [
      unit("1", "input", { daemonId: "laptop" }),
      unit("1", "input", { daemonId: "workstation" }),
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
