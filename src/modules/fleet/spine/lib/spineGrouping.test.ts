import { describe, expect, it } from "vitest";
import type { AdoptableSession } from "../../lib/fleetAdopt";
import type { FleetStatus, FleetUnit } from "../../lib/fleetRoster";
import { buildSpineGroups, shouldShowHostBadges } from "./spineGrouping";

function unit(
  over: Partial<FleetUnit> & { id: string; name: string; status: FleetStatus },
): FleetUnit {
  return { repo: "/r/app", repoName: "app", daemonId: "d1", ...over };
}

function session(over: Partial<AdoptableSession> & { key: string }): AdoptableSession {
  return {
    harness: "claude-code",
    sessionId: "s1",
    cwd: "/r/app",
    repoName: "app",
    ...over,
  };
}

describe("buildSpineGroups", () => {
  it("groups units by project, then by daemon", () => {
    const units = [
      unit({ id: "1", name: "a", status: "idle", repo: "/r/app", repoName: "app", daemonId: "d1" }),
      unit({ id: "2", name: "b", status: "idle", repo: "/r/api", repoName: "api", daemonId: "d1" }),
      unit({ id: "3", name: "c", status: "idle", repo: "/r/app", repoName: "app", daemonId: "d2" }),
    ];
    const groups = buildSpineGroups(units, [], null);
    expect(groups.map((g) => g.projectKey).sort()).toEqual(["api", "app"]);
    const app = groups.find((g) => g.projectKey === "app");
    expect(app?.daemonGroups.map((d) => d.daemonId).sort()).toEqual(["d1", "d2"]);
  });

  it("orders project groups by the server roll-up tier, then alphabetically", () => {
    const units = [
      unit({ id: "1", name: "a", status: "idle", repo: "/r/zzz", repoName: "zzz", ladderPriority: "idle" }),
      unit({ id: "2", name: "b", status: "input", repo: "/r/aaa", repoName: "aaa", ladderPriority: "awaiting-input" }), // needs you
      unit({ id: "3", name: "c", status: "idle", repo: "/r/bbb", repoName: "bbb", ladderPriority: "idle" }),
    ];
    const groups = buildSpineGroups(units, [], null);
    // The awaiting-input project ("aaa") outranks idle projects regardless of alpha order.
    expect(groups[0].projectKey).toBe("aaa");
    expect(groups[0].hasAttention).toBe(true);
    // Remaining idle projects fall back to alphabetical.
    expect(groups.slice(1).map((g) => g.projectKey)).toEqual(["bbb", "zzz"]);
  });

  it("computes rollupPriority as the group's most-urgent server tier (maxLadderPriority)", () => {
    const units = [
      unit({ id: "1", name: "a", status: "working", ladderPriority: "working" }),
      unit({ id: "2", name: "b", status: "error", ladderPriority: "error" }),
    ];
    const groups = buildSpineGroups(units, [], null);
    expect(groups[0].rollupPriority).toBe("error");
    expect(groups[0].hasAttention).toBe(true);
  });

  it("puts adoptable sessions into the active daemon's bucket, keyed by project", () => {
    const sessions = [session({ key: "s1", cwd: "/r/app", repoName: "app" })];
    const groups = buildSpineGroups([], sessions, { id: "active-1", label: "Local" });
    expect(groups).toHaveLength(1);
    expect(groups[0].projectKey).toBe("app");
    expect(groups[0].rank).toBe(7); // ADOPT_ONLY_RANK (ladderRank("idle") + 1) — below any real unit group
    expect(groups[0].rollupPriority).toBeUndefined();
    expect(groups[0].daemonGroups[0].daemonId).toBe("active-1");
    expect(groups[0].daemonGroups[0].rows[0]).toMatchObject({
      kind: "adopt",
      key: "adopt:s1",
    });
  });

  it("drops adoptable sessions when there is no active daemon yet", () => {
    const sessions = [session({ key: "s1" })];
    const groups = buildSpineGroups([], sessions, null);
    expect(groups).toHaveLength(0);
  });

  it("mixes unit and adopt rows in the same project/daemon bucket", () => {
    const units = [unit({ id: "1", name: "a", status: "idle", daemonId: "active-1" })];
    const sessions = [session({ key: "s1" })];
    const groups = buildSpineGroups(units, sessions, {
      id: "active-1",
      label: "Local",
    });
    expect(groups).toHaveLength(1);
    const rows = groups[0].daemonGroups[0].rows;
    expect(rows.map((r) => r.kind)).toEqual(["unit", "adopt"]);
  });
});

describe("shouldShowHostBadges", () => {
  it("is false with a single daemon across the whole grouped roster", () => {
    const units = [
      unit({ id: "1", name: "a", status: "idle", repo: "/r/app", daemonId: "d1" }),
      unit({ id: "2", name: "b", status: "idle", repo: "/r/api", daemonId: "d1" }),
    ];
    expect(shouldShowHostBadges(buildSpineGroups(units, [], null))).toBe(false);
  });

  it("is true once ≥2 daemons appear anywhere in the grouped roster", () => {
    const units = [
      unit({ id: "1", name: "a", status: "idle", repo: "/r/app", daemonId: "d1" }),
      unit({ id: "2", name: "b", status: "idle", repo: "/r/app", daemonId: "d2" }),
    ];
    expect(shouldShowHostBadges(buildSpineGroups(units, [], null))).toBe(true);
  });
});
