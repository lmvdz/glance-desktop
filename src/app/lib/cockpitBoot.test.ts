import { describe, expect, it } from "vitest";
import {
  type CockpitBootInputs,
  planCockpitBoot,
} from "./cockpitBoot";

/** All-clear inputs: cockpit-first would open a fresh fleet tab. Each test
 *  overrides just the axis under scrutiny. */
function inputs(over: Partial<CockpitBootInputs> = {}): CockpitBootInputs {
  return {
    openFleetOnLaunch: true,
    connectionConfigured: true,
    hasExplicitLaunchTarget: false,
    existingFleetTabId: null,
    ...over,
  };
}

describe("planCockpitBoot", () => {
  it("opens a fleet tab when a connection is configured and nothing else intervenes", () => {
    expect(planCockpitBoot(inputs())).toEqual({ kind: "open" });
  });

  it("focuses an existing fleet tab instead of opening a second one", () => {
    expect(planCockpitBoot(inputs({ existingFleetTabId: 7 }))).toEqual({
      kind: "focus",
      tabId: 7,
    });
  });

  it("does nothing when no connection is configured (ADE boot unchanged)", () => {
    expect(planCockpitBoot(inputs({ connectionConfigured: false }))).toEqual({
      kind: "none",
    });
  });

  it("does nothing when the toggle is off, even with a connection", () => {
    expect(planCockpitBoot(inputs({ openFleetOnLaunch: false }))).toEqual({
      kind: "none",
    });
  });

  it("does nothing (does not even focus) when the toggle is off but a fleet tab exists", () => {
    expect(
      planCockpitBoot(
        inputs({ openFleetOnLaunch: false, existingFleetTabId: 3 }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("yields to an explicit launch target over opening the cockpit", () => {
    expect(
      planCockpitBoot(inputs({ hasExplicitLaunchTarget: true })),
    ).toEqual({ kind: "none" });
  });

  it("yields to an explicit launch target even when a fleet tab was restored", () => {
    expect(
      planCockpitBoot(
        inputs({ hasExplicitLaunchTarget: true, existingFleetTabId: 5 }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("launch target wins even with the toggle on and a connection configured", () => {
    expect(
      planCockpitBoot(
        inputs({
          hasExplicitLaunchTarget: true,
          openFleetOnLaunch: true,
          connectionConfigured: true,
        }),
      ),
    ).toEqual({ kind: "none" });
  });
});
