import { describe, expect, it } from "vitest";
import {
  type FleetStatus,
  type FleetUnit,
  aggregateConnection,
  attentionReason,
  attentionUnits,
  isValidatorHeld,
  mergeRosters,
  normalizeRoster,
  rankUnit,
  sortUnits,
  tagUnits,
  unitKey,
} from "./fleetRoster";

function unit(
  over: Partial<FleetUnit> & { id: string; name: string; status: FleetStatus },
): FleetUnit {
  return { repo: "/r", daemonId: "d1", ...over };
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
