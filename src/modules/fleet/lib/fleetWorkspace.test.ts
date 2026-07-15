import { describe, expect, it } from "vitest";
import {
  type FleetLease,
  LEASE_TTL_MS,
  groupByHolder,
  isHumanHolder,
  liveLeases,
  normalizeLeases,
} from "./fleetWorkspace";

function lease(
  over: Partial<FleetLease> & {
    session: string;
    file: string;
    heartbeat: number;
  },
): FleetLease {
  return {
    id: `${over.session}:${over.file}`,
    repo: "/r",
    operator: "u",
    host: "h",
    since: 0,
    ...over,
  };
}

describe("liveLeases — the daemon's TTL applied client-side", () => {
  it("drops leases whose heartbeat is older than the TTL", () => {
    const now = 1_000_000;
    const live = lease({
      session: "omp:1",
      file: "a.ts",
      heartbeat: now - 10_000,
    });
    const dead = lease({
      session: "omp:1",
      file: "b.ts",
      heartbeat: now - (LEASE_TTL_MS + 1),
    });
    expect(liveLeases([live, dead], now).map((l) => l.file)).toEqual(["a.ts"]);
  });
});

describe("isHumanHolder", () => {
  it("recognizes a cockpit session as the human, agents as not", () => {
    expect(isHumanHolder("glance-cockpit:s1")).toBe(true);
    expect(isHumanHolder("omp:1234")).toBe(false);
    expect(isHumanHolder("squad:agent-a")).toBe(false);
  });
});

describe("groupByHolder — the overlay rows", () => {
  it("groups files by session, human holders first, files deduped + sorted", () => {
    const groups = groupByHolder([
      lease({ session: "omp:1", file: "z.ts", heartbeat: 0 }),
      lease({ session: "omp:1", file: "a.ts", heartbeat: 0 }),
      lease({ session: "omp:1", file: "a.ts", heartbeat: 0 }), // dup
      lease({ session: "glance-cockpit:me", file: "m.ts", heartbeat: 0 }),
    ]);
    expect(
      groups.map((g) => ({ s: g.session, human: g.human, files: g.files })),
    ).toEqual([
      { s: "glance-cockpit:me", human: true, files: ["m.ts"] }, // human first
      { s: "omp:1", human: false, files: ["a.ts", "z.ts"] }, // deduped + sorted
    ]);
  });

  it("empty in → empty out", () => {
    expect(groupByHolder([])).toEqual([]);
  });
});

describe("normalizeLeases — untrusted payload", () => {
  it("keeps well-formed leases, drops junk", () => {
    const raw = [
      {
        id: "1",
        repo: "/r",
        file: "a.ts",
        operator: "u",
        session: "omp:1",
        host: "h",
        since: 0,
        heartbeat: 5,
      },
      { file: "b.ts" }, // no session/heartbeat
      null,
      "nope",
    ];
    expect(normalizeLeases(raw).map((l) => l.file)).toEqual(["a.ts"]);
    expect(normalizeLeases({ error: "x" })).toEqual([]);
  });
});
