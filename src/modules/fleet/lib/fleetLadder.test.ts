import { describe, expect, it } from "vitest";
import {
  LADDER_RANK,
  type LadderPriority,
  ladderAlertTitle,
  ladderMeta,
  ladderRank,
  ladderReason,
  maxLadderPriority,
  needsHuman,
} from "./fleetLadder";
import type { FleetStatus, FleetUnit } from "./fleetRoster";

function unit(
  over: Partial<FleetUnit> & { id: string; name: string; status: FleetStatus },
): FleetUnit {
  return { repo: "/r", daemonId: "d1", ...over };
}

describe("LADDER_RANK / ladderRank — mirrors the daemon's published order", () => {
  it("orders error < pending-approval < awaiting-input < working < plan-ready < completed-unseen < idle", () => {
    expect(LADDER_RANK).toEqual([
      "error",
      "pending-approval",
      "awaiting-input",
      "working",
      "plan-ready",
      "completed-unseen",
      "idle",
    ]);
    for (let i = 1; i < LADDER_RANK.length; i++) {
      expect(ladderRank(LADDER_RANK[i - 1])).toBeLessThan(
        ladderRank(LADDER_RANK[i]),
      );
    }
  });

  it("treats an absent or unknown tier as idle (never floated to the top)", () => {
    expect(ladderRank(undefined)).toBe(ladderRank("idle"));
    expect(ladderRank("bogus" as LadderPriority)).toBe(ladderRank("idle"));
  });
});

describe("maxLadderPriority — the group roll-up (mirror of the daemon's own)", () => {
  it("returns the most-urgent tier present", () => {
    expect(maxLadderPriority(["idle", "working", "error"])).toBe("error");
    expect(maxLadderPriority(["completed-unseen", "plan-ready"])).toBe(
      "plan-ready",
    );
  });

  it("an empty group (or all-undefined) reads as idle, not undefined", () => {
    expect(maxLadderPriority([])).toBe("idle");
    expect(maxLadderPriority([undefined, undefined])).toBe("idle");
  });

  it("ignores undefined tiers when a real one is present", () => {
    expect(maxLadderPriority([undefined, "awaiting-input", undefined])).toBe(
      "awaiting-input",
    );
  });
});

describe("needsHuman — the daemon's attention set", () => {
  it("is true only for error / pending-approval / awaiting-input", () => {
    for (const p of [
      "error",
      "pending-approval",
      "awaiting-input",
    ] as LadderPriority[]) {
      expect(needsHuman({ ladderPriority: p })).toBe(true);
    }
    for (const p of [
      "working",
      "plan-ready",
      "completed-unseen",
      "idle",
    ] as LadderPriority[]) {
      expect(needsHuman({ ladderPriority: p })).toBe(false);
    }
    expect(needsHuman({ ladderPriority: undefined })).toBe(false);
  });
});

describe("ladderMeta — the tier → t3 status-token mapping", () => {
  it("maps every tier to its token dot + label", () => {
    expect(ladderMeta("error")).toMatchObject({
      dot: "bg-destructive",
      label: "error",
    });
    expect(ladderMeta("pending-approval")).toMatchObject({
      dot: "bg-warning",
      label: "approve",
    });
    expect(ladderMeta("awaiting-input")).toMatchObject({
      dot: "bg-info",
      label: "input",
    });
    expect(ladderMeta("working")).toMatchObject({
      dot: "bg-info",
      label: "working",
    });
    expect(ladderMeta("plan-ready")).toMatchObject({
      dot: "bg-pending",
      label: "ready",
    });
    expect(ladderMeta("completed-unseen")).toMatchObject({
      dot: "bg-success",
      label: "done",
    });
    expect(ladderMeta("idle").label).toBe("idle");
  });

  it("pulses ONLY the in-flight working tier", () => {
    expect(ladderMeta("working").pulse).toBe(true);
    for (const p of [
      "error",
      "pending-approval",
      "awaiting-input",
      "plan-ready",
      "completed-unseen",
      "idle",
    ] as LadderPriority[]) {
      expect(ladderMeta(p).pulse).toBeFalsy();
    }
  });

  it("resolves to token utilities, never raw palette classes (theme-repaintable)", () => {
    for (const p of LADDER_RANK) {
      const dot = ladderMeta(p).dot;
      // Token utilities only — never a raw numbered tailwind palette class (see the regex below).
      expect(dot).not.toMatch(
        /bg-(red|amber|blue|emerald|violet|sky|indigo|gray|slate)-\d/,
      );
    }
  });

  it("falls back to idle meta for an absent/unknown tier", () => {
    expect(ladderMeta(undefined)).toEqual(ladderMeta("idle"));
    expect(ladderMeta("bogus" as LadderPriority)).toEqual(ladderMeta("idle"));
  });
});

describe("ladderReason — descriptive text for the pill tooltip / alert body", () => {
  it("surfaces the pending title for the input/approval tiers", () => {
    expect(
      ladderReason(
        unit({
          id: "1",
          name: "a",
          status: "input",
          ladderPriority: "awaiting-input",
          pending: [{ id: "p", title: "Approve rm -rf?" }],
        }),
      ),
    ).toBe("Approve rm -rf?");
    expect(
      ladderReason(
        unit({
          id: "2",
          name: "a",
          status: "input",
          ladderPriority: "pending-approval",
          pending: [{ id: "p", title: "Run migration?" }],
        }),
      ),
    ).toBe("Run migration?");
  });

  it("surfaces the error text, held verdict, or closed-PR for the error tier", () => {
    expect(
      ladderReason(
        unit({
          id: "1",
          name: "a",
          status: "error",
          ladderPriority: "error",
          error: "child crashed",
        }),
      ),
    ).toBe("child crashed");
    expect(
      ladderReason(
        unit({
          id: "2",
          name: "a",
          status: "idle",
          ladderPriority: "error",
          landReady: true,
          validation: { verdict: "veto" },
        }),
      ),
    ).toContain("veto");
    expect(
      ladderReason(
        unit({
          id: "3",
          name: "a",
          status: "idle",
          ladderPriority: "error",
          prState: "closed",
        }),
      ),
    ).toContain("closed");
  });

  it("is empty for working / idle (tooltip falls back to the label)", () => {
    expect(
      ladderReason(
        unit({
          id: "1",
          name: "a",
          status: "working",
          ladderPriority: "working",
        }),
      ),
    ).toBe("");
    expect(
      ladderReason(
        unit({ id: "2", name: "a", status: "idle", ladderPriority: "idle" }),
      ),
    ).toBe("");
  });
});

describe("ladderAlertTitle — the bell's notification title", () => {
  it("reads 'errored' for the error tier, 'needs you' otherwise", () => {
    expect(
      ladderAlertTitle(
        unit({ id: "1", name: "boom", status: "error", ladderPriority: "error" }),
      ),
    ).toContain("errored");
    expect(
      ladderAlertTitle(
        unit({
          id: "2",
          name: "ask",
          status: "input",
          ladderPriority: "awaiting-input",
        }),
      ),
    ).toContain("needs you");
  });
});
