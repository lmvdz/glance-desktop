import { describe, expect, it } from "vitest";
import {
  IDLE_TAKEOVER,
  type TakeoverState,
  canHandBack,
  canTakeOver,
  cockpitAgentLabel,
  resumePrompt,
} from "./fleetTakeover";

describe("cockpitAgentLabel", () => {
  it("namespaces the human's presence as glance-cockpit: (not a reserved omp:/squad:)", () => {
    expect(cockpitAgentLabel("abc-123")).toBe("glance-cockpit:abc-123");
  });
});

describe("resumePrompt — hand-back message", () => {
  it("names the changed files so the agent re-reads them", () => {
    const p = resumePrompt(["src/a.ts", "src/b.ts"]);
    expect(p).toContain("src/a.ts");
    expect(p).toContain("src/b.ts");
    expect(p.toLowerCase()).toContain("re-read");
  });

  it("caps the list and notes the overflow", () => {
    const p = resumePrompt(Array.from({ length: 12 }, (_, i) => `f${i}.ts`));
    expect(p).toContain("and 4 more");
  });

  it("stays generic when no files are known", () => {
    const p = resumePrompt([]);
    expect(p.toLowerCase()).toContain("re-read");
    expect(p).not.toContain(",");
  });
});

describe("takeover state guards", () => {
  it("take over only from idle; hand back only while active", () => {
    expect(canTakeOver(IDLE_TAKEOVER)).toBe(true);
    expect(canHandBack(IDLE_TAKEOVER)).toBe(false);

    const active: TakeoverState = {
      phase: "active",
      priorMode: "assist",
      presenceId: "p1",
      error: null,
    };
    expect(canTakeOver(active)).toBe(false); // no double-takeover
    expect(canHandBack(active)).toBe(true);

    const takingOver: TakeoverState = {
      phase: "taking-over",
      priorMode: "assist",
      presenceId: null,
      error: null,
    };
    expect(canTakeOver(takingOver)).toBe(false);
    expect(canHandBack(takingOver)).toBe(false); // can't hand back mid-takeover
  });
});
