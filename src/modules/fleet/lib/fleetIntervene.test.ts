import { describe, expect, it } from "vitest";
import type { FleetStatus, FleetUnit } from "./fleetRoster";
import { normalizeDiff, whyStopped } from "./fleetIntervene";

function unit(over: Partial<FleetUnit> & { status: FleetStatus }): FleetUnit {
  return { id: "1", name: "u", repo: "/r", daemonId: "d1", ...over };
}

describe("whyStopped — the human-facing reason", () => {
  it("flags input/error as needing a human, with the pending title / error text", () => {
    expect(
      whyStopped(
        unit({
          status: "input",
          pending: [{ id: "p", title: "Approve deploy?" }],
        }),
      ),
    ).toEqual({
      label: "Waiting for you",
      detail: "Approve deploy?",
      needsHuman: true,
    });
    expect(
      whyStopped(unit({ status: "error", error: "OOM killed" })),
    ).toMatchObject({ needsHuman: true, detail: "OOM killed" });
  });

  it("running/idle states do not demand a human", () => {
    expect(whyStopped(unit({ status: "working" })).needsHuman).toBe(false);
    expect(whyStopped(unit({ status: "idle" })).needsHuman).toBe(false);
    expect(whyStopped(unit({ status: "starting" })).needsHuman).toBe(false);
    expect(whyStopped(unit({ status: "stopped" })).needsHuman).toBe(false);
  });

  it("falls back gracefully when the pending title / error is absent", () => {
    expect(whyStopped(unit({ status: "input" })).detail).toBeTruthy();
    expect(whyStopped(unit({ status: "error" })).detail).toBeTruthy();
  });
});

describe("normalizeDiff — untrusted diff payload", () => {
  it("keeps well-formed file-diffs and drops junk", () => {
    const raw = [
      { file: "a.ts", status: "M", diff: "@@ .." },
      { file: "b.ts" }, // no diff string
      null,
      "nope",
    ];
    expect(normalizeDiff(raw).map((d) => d.file)).toEqual(["a.ts"]);
  });

  it("returns [] for a non-array payload", () => {
    expect(normalizeDiff({ error: "boom" })).toEqual([]);
  });
});
