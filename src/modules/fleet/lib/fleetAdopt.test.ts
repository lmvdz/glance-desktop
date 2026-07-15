import { describe, expect, it } from "vitest";
import {
  type PresenceEntry,
  adoptableSessions,
  normalizePresence,
  parseAdhocAgent,
} from "./fleetAdopt";

describe("parseAdhocAgent", () => {
  it("splits on the first colon (sessionId may be a UUID)", () => {
    expect(parseAdhocAgent("claude-code:abc-123-def")).toEqual({
      harness: "claude-code",
      sessionId: "abc-123-def",
    });
  });
  it("rejects labels without a usable split", () => {
    expect(parseAdhocAgent("nocolon")).toBeNull();
    expect(parseAdhocAgent(":leading")).toBeNull();
    expect(parseAdhocAgent("trailing:")).toBeNull();
  });
});

describe("adoptableSessions", () => {
  const rows: PresenceEntry[] = [
    { id: "1", repo: "/r/app", repoName: "app", agent: "claude-code:s1", source: "other" },
    { id: "2", repo: "/r/app", repoName: "app", agent: "squad:agent-7", source: "squad" }, // daemon's own
    { id: "3", repo: "/r/api", repoName: "api", agent: "codex:s2", source: "other" },
    { id: "4", repo: "/r/app", repoName: "app", agent: "claude-code:s1", source: "other" }, // dup of #1
  ];

  it("keeps only external (source=other) parseable sessions, deduped", () => {
    const out = adoptableSessions(rows);
    expect(out.map((s) => s.sessionId).sort()).toEqual(["s1", "s2"]);
    const s1 = out.find((s) => s.sessionId === "s1");
    expect(s1).toMatchObject({ harness: "claude-code", cwd: "/r/app", repoName: "app" });
  });

  it("excludes sessions already tracked as units", () => {
    const out = adoptableSessions(rows, new Set(["claude-code:s1"]));
    expect(out.map((s) => s.sessionId)).toEqual(["s2"]);
  });

  it("derives repoName from the path when absent", () => {
    const out = adoptableSessions([
      { id: "x", repo: "/srv/my-proj", agent: "claude-code:z", source: "other" },
    ]);
    expect(out[0].repoName).toBe("my-proj");
  });
});

describe("normalizePresence", () => {
  it("drops malformed rows", () => {
    expect(
      normalizePresence([
        { repo: "/r", agent: "a:b" },
        { repo: 5, agent: "x" },
        null,
        "nope",
      ]),
    ).toHaveLength(1);
    expect(normalizePresence("not-array")).toEqual([]);
  });
});
