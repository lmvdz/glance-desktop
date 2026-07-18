import { describe, expect, it } from "vitest";
import { planShellBoot, type ShellBootInputs } from "./shellBoot";

/** All-clear inputs: a plain first launch with the toggle on would boot the
 *  hub. Each test overrides just the axis under scrutiny. */
function inputs(over: Partial<ShellBootInputs> = {}): ShellBootInputs {
  return {
    hasExplicitLaunchTarget: false,
    persistedMode: null,
    openFleetOnLaunch: true,
    ...over,
  };
}

describe("planShellBoot", () => {
  it("boots the hub on a plain first launch (unconditional default)", () => {
    expect(planShellBoot(inputs())).toBe("hub");
  });

  it("boots workspace when launched on an explicit file/folder target", () => {
    expect(planShellBoot(inputs({ hasExplicitLaunchTarget: true }))).toBe(
      "workspace",
    );
  });

  it("launch target wins over a persisted hub mode", () => {
    expect(
      planShellBoot(
        inputs({ hasExplicitLaunchTarget: true, persistedMode: "hub" }),
      ),
    ).toBe("workspace");
  });

  it("restores a persisted workspace mode on a plain launch", () => {
    expect(planShellBoot(inputs({ persistedMode: "workspace" }))).toBe(
      "workspace",
    );
  });

  it("restores a persisted hub mode on a plain launch", () => {
    expect(planShellBoot(inputs({ persistedMode: "hub" }))).toBe("hub");
  });

  it("persisted mode wins over the first-run toggle (last position sticks)", () => {
    // Toggle is off, but the user last left the hub open → honor the hub.
    expect(
      planShellBoot(inputs({ persistedMode: "hub", openFleetOnLaunch: false })),
    ).toBe("hub");
    // Toggle is on, but the user last left the workspace open → honor it.
    expect(
      planShellBoot(
        inputs({ persistedMode: "workspace", openFleetOnLaunch: true }),
      ),
    ).toBe("workspace");
  });

  it("first-launch default follows the toggle when nothing is persisted", () => {
    expect(planShellBoot(inputs({ openFleetOnLaunch: true }))).toBe("hub");
    expect(planShellBoot(inputs({ openFleetOnLaunch: false }))).toBe(
      "workspace",
    );
  });
});
