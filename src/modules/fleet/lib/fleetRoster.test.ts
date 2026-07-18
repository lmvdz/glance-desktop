import { describe, expect, it } from "vitest";
import type { LadderPriority } from "./fleetLadder";
import {
  type FleetStatus,
  type FleetUnit,
  aggregateConnection,
  mergeRosters,
  normalizeRoster,
  sortUnits,
  tagUnits,
  unitKey,
} from "./fleetRoster";

function unit(
  over: Partial<FleetUnit> & { id: string; name: string; status: FleetStatus },
): FleetUnit {
  return { repo: "/r", daemonId: "d1", ...over };
}

describe("sortUnits — orders by the daemon's server tier, then name", () => {
  it("floats more-urgent server tiers first; equal tiers fall back to name (no jitter)", () => {
    const p = (priority: LadderPriority): Partial<FleetUnit> => ({
      ladderPriority: priority,
    });
    const units = [
      unit({ id: "1", name: "zed", status: "idle", ...p("idle") }),
      unit({ id: "2", name: "abe", status: "input", ...p("awaiting-input") }),
      unit({ id: "3", name: "mox", status: "idle", ...p("idle") }),
      unit({ id: "4", name: "err", status: "error", ...p("error") }),
    ];
    // error < awaiting-input < idle; the two idle rows tie and sort by name (mox < zed).
    expect(sortUnits(units).map((u) => u.name)).toEqual([
      "err",
      "abe",
      "mox",
      "zed",
    ]);
  });

  it("treats a unit with no server tier as idle (a pre-concern-06 daemon), never floated up", () => {
    const units = [
      unit({ id: "1", name: "untiered", status: "working" }), // no ladderPriority
      unit({
        id: "2",
        name: "blocked",
        status: "input",
        ladderPriority: "awaiting-input",
      }),
    ];
    expect(sortUnits(units).map((u) => u.name)).toEqual(["blocked", "untiered"]);
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

  it("carries the daemon's ladderPriority through unchanged (the cockpit renders it)", () => {
    const out = normalizeRoster([
      { id: "1", name: "ok", status: "idle", ladderPriority: "completed-unseen" },
    ]);
    expect(out[0].ladderPriority).toBe("completed-unseen");
  });

  it("returns [] for a non-array payload", () => {
    expect(normalizeRoster({ error: "boom" })).toEqual([]);
    expect(normalizeRoster(null)).toEqual([]);
  });
});

describe("tagUnits — stamp each unit with its source daemon (M02)", () => {
  it("stamps daemonId and daemonLabel on every unit", () => {
    const units = [
      unit({ id: "1", name: "a", status: "idle" }),
      unit({ id: "2", name: "b", status: "working" }),
    ];
    const tagged = tagUnits(units, "workstation", "Workstation");
    expect(tagged).toEqual([
      { ...units[0], daemonId: "workstation", daemonLabel: "Workstation" },
      { ...units[1], daemonId: "workstation", daemonLabel: "Workstation" },
    ]);
  });

  it("daemonLabel is optional and omitted cleanly", () => {
    const [tagged] = tagUnits(
      [unit({ id: "1", name: "a", status: "idle" })],
      "d2",
    );
    expect(tagged.daemonId).toBe("d2");
    expect(tagged.daemonLabel).toBeUndefined();
  });

  it("does not mutate the input units", () => {
    const original = unit({
      id: "1",
      name: "a",
      status: "idle",
      daemonId: "old",
    });
    const [tagged] = tagUnits([original], "new");
    expect(original.daemonId).toBe("old");
    expect(tagged.daemonId).toBe("new");
    expect(tagged).not.toBe(original);
  });
});

describe("unitKey — disambiguates units whose ids collide across daemons", () => {
  it("combines daemonId and id", () => {
    expect(unitKey({ daemonId: "laptop", id: "42" })).toBe("laptop:42");
  });

  it("two daemons' same-id units produce different keys", () => {
    const a = unitKey({ daemonId: "laptop", id: "42" });
    const b = unitKey({ daemonId: "workstation", id: "42" });
    expect(a).not.toBe(b);
  });
});

describe("mergeRosters — combine per-daemon fetches into one roster", () => {
  it("concatenates units from every daemon", () => {
    const laptop = tagUnits(
      [unit({ id: "1", name: "a", status: "idle" })],
      "laptop",
      "Laptop",
    );
    const workstation = tagUnits(
      [unit({ id: "1", name: "b", status: "working" })],
      "workstation",
      "Workstation",
    );
    const merged = mergeRosters([laptop, workstation]);
    expect(merged).toHaveLength(2);
    expect(merged.map((u) => unitKey(u)).sort()).toEqual([
      "laptop:1",
      "workstation:1",
    ]);
  });

  it("dedupes same-daemon same-id units, keeping the later list's version", () => {
    const stale = tagUnits(
      [unit({ id: "1", name: "old-name", status: "idle" })],
      "d1",
    );
    const fresh = tagUnits(
      [unit({ id: "1", name: "new-name", status: "working" })],
      "d1",
    );
    const merged = mergeRosters([stale, fresh]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("new-name");
  });

  it("a daemon that returned nothing contributes no rows but doesn't break the merge", () => {
    const empty: FleetUnit[] = [];
    const laptop = tagUnits(
      [unit({ id: "1", name: "a", status: "idle" })],
      "laptop",
    );
    expect(mergeRosters([empty, laptop])).toHaveLength(1);
  });

  it("empty input yields an empty roster", () => {
    expect(mergeRosters([])).toEqual([]);
  });
});

describe("aggregateConnection — roll per-daemon status up into one headline state", () => {
  it("is live the moment any daemon is live, even if others are degraded", () => {
    expect(
      aggregateConnection({ a: "live", b: "reconnecting", c: "unauthorized" }),
    ).toBe("live");
  });

  it("is connecting while any daemon is still on its first probe (and none are live)", () => {
    expect(aggregateConnection({ a: "connecting", b: "reconnecting" })).toBe(
      "connecting",
    );
  });

  it("is unauthorized only when EVERY daemon refuses the token", () => {
    expect(aggregateConnection({ a: "unauthorized", b: "unauthorized" })).toBe(
      "unauthorized",
    );
    expect(aggregateConnection({ a: "unauthorized", b: "reconnecting" })).toBe(
      "reconnecting",
    );
  });

  it("is reconnecting for any other degraded mix", () => {
    expect(aggregateConnection({ a: "reconnecting" })).toBe("reconnecting");
  });

  it("no configured daemons reads as connecting, not an error", () => {
    expect(aggregateConnection({})).toBe("connecting");
  });
});
