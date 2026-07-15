import { describe, expect, it } from "vitest";
import {
  type FleetStatus,
  type FleetUnit,
  attentionReason,
  attentionUnits,
  isValidatorHeld,
  normalizeRoster,
  rankUnit,
  sortUnits,
} from "./fleetRoster";

function unit(
  over: Partial<FleetUnit> & { id: string; name: string; status: FleetStatus },
): FleetUnit {
  return { repo: "/r", ...over };
}

describe("rankUnit — mirrors the daemon TUI ordering", () => {
  it("orders input < error < held < land-ready < working < idle < starting < stopped", () => {
    const ranks = {
      input: rankUnit(unit({ id: "1", name: "a", status: "input" })),
      error: rankUnit(unit({ id: "2", name: "b", status: "error" })),
      held: rankUnit(
        unit({
          id: "3",
          name: "c",
          status: "idle",
          landReady: true,
          validation: { verdict: "veto" },
        }),
      ),
      landReady: rankUnit(
        unit({
          id: "4",
          name: "d",
          status: "idle",
          landReady: true,
          validation: { verdict: "approve" },
        }),
      ),
      working: rankUnit(unit({ id: "5", name: "e", status: "working" })),
      idle: rankUnit(unit({ id: "6", name: "f", status: "idle" })),
      starting: rankUnit(unit({ id: "7", name: "g", status: "starting" })),
      stopped: rankUnit(unit({ id: "8", name: "h", status: "stopped" })),
    };
    expect(ranks.input).toBeLessThan(ranks.error);
    expect(ranks.error).toBeLessThan(ranks.held);
    expect(ranks.held).toBeLessThan(ranks.landReady);
    expect(ranks.landReady).toBeLessThan(ranks.working);
    expect(ranks.working).toBeLessThan(ranks.idle);
    expect(ranks.idle).toBeLessThan(ranks.starting);
    expect(ranks.starting).toBeLessThan(ranks.stopped);
  });
});

describe("isValidatorHeld", () => {
  it("is held only when land-ready AND the verdict is not approve", () => {
    expect(
      isValidatorHeld(
        unit({
          id: "1",
          name: "a",
          status: "idle",
          landReady: true,
          validation: { verdict: "veto" },
        }),
      ),
    ).toBe(true);
    expect(
      isValidatorHeld(
        unit({
          id: "2",
          name: "a",
          status: "idle",
          landReady: true,
          validation: { verdict: "approve" },
        }),
      ),
    ).toBe(false);
    expect(
      isValidatorHeld(
        unit({ id: "3", name: "a", status: "idle", landReady: true }),
      ),
    ).toBe(false); // no verdict = not held
    expect(
      isValidatorHeld(
        unit({
          id: "4",
          name: "a",
          status: "idle",
          validation: { verdict: "veto" },
        }),
      ),
    ).toBe(false); // not land-ready
  });
});

describe("sortUnits", () => {
  it("sorts by rank, then name for equal ranks (no jitter)", () => {
    const units = [
      unit({ id: "1", name: "zed", status: "idle" }),
      unit({ id: "2", name: "abe", status: "input" }),
      unit({ id: "3", name: "mox", status: "idle" }),
    ];
    expect(sortUnits(units).map((u) => u.name)).toEqual(["abe", "mox", "zed"]);
  });
});

describe("attentionUnits", () => {
  it("includes only input, error, and held — the rank ≤ 2 set, sorted", () => {
    const units = [
      unit({ id: "1", name: "working", status: "working" }),
      unit({ id: "2", name: "errored", status: "error" }),
      unit({ id: "3", name: "blocked", status: "input" }),
      unit({ id: "4", name: "idle", status: "idle" }),
      unit({
        id: "5",
        name: "held",
        status: "idle",
        landReady: true,
        validation: { verdict: "veto" },
      }),
    ];
    expect(attentionUnits(units).map((u) => u.name)).toEqual([
      "blocked",
      "errored",
      "held",
    ]);
  });
});

describe("attentionReason", () => {
  it("surfaces the pending title, the error, or the held verdict", () => {
    expect(
      attentionReason(
        unit({
          id: "1",
          name: "a",
          status: "input",
          pending: [{ id: "p", title: "Approve rm -rf?" }],
        }),
      ),
    ).toBe("Approve rm -rf?");
    expect(
      attentionReason(
        unit({ id: "2", name: "a", status: "error", error: "child crashed" }),
      ),
    ).toBe("child crashed");
    expect(
      attentionReason(
        unit({
          id: "3",
          name: "a",
          status: "idle",
          landReady: true,
          validation: { verdict: "veto" },
        }),
      ),
    ).toContain("veto");
    expect(
      attentionReason(unit({ id: "4", name: "a", status: "working" })),
    ).toBe("");
  });
});

describe("normalizeRoster — untrusted payload", () => {
  it("keeps well-formed units and drops junk", () => {
    const raw = [
      { id: "1", name: "ok", status: "working", extra: "ignored" },
      { id: "2", name: "no-status" },
      null,
      "string",
      { name: "no-id", status: "idle" },
    ];
    const out = normalizeRoster(raw);
    expect(out.map((u) => u.id)).toEqual(["1"]);
  });

  it("returns [] for a non-array payload", () => {
    expect(normalizeRoster({ error: "boom" })).toEqual([]);
    expect(normalizeRoster(null)).toEqual([]);
  });
});
