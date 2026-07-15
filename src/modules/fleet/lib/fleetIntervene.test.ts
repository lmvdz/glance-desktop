import { describe, expect, it } from "vitest";
import type { FleetStatus, FleetUnit } from "./fleetRoster";
import { diffLineKind, normalizeDiff, whyStopped } from "./fleetIntervene";

function unit(over: Partial<FleetUnit> & { status: FleetStatus }): FleetUnit {
  return { id: "1", name: "u", repo: "/r", daemonId: "d1", ...over };
}

describe("diffLineKind — unified-diff colorization", () => {
  it("classifies adds, dels, hunks, meta, and context", () => {
    expect(diffLineKind("+added line")).toBe("add");
    expect(diffLineKind("-removed line")).toBe("del");
    expect(diffLineKind("@@ -1,3 +1,4 @@")).toBe("hunk");
    expect(diffLineKind("+++ b/file.ts")).toBe("meta"); // file header, not an add
    expect(diffLineKind("--- a/file.ts")).toBe("meta"); // file header, not a del
    expect(diffLineKind("diff --git a/x b/x")).toBe("meta");
    expect(diffLineKind("index abc..def 100644")).toBe("meta");
    expect(diffLineKind(" unchanged")).toBe("context");
    expect(diffLineKind("")).toBe("context");
  });
});

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
