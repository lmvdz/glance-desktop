import { describe, expect, it } from "vitest";
import { resolveGrrRepo } from "./grrRepo";

describe("resolveGrrRepo", () => {
  it("uses the selected fleet unit's repo when a fleet tab is focused", () => {
    expect(
      resolveGrrRepo({
        fleetTabActive: true,
        selectedUnitRepo: "/home/me/unit-repo",
        workspaceCwd: "/home/me/workspace",
      }),
    ).toBe("/home/me/unit-repo");
  });

  it("falls back to the workspace cwd when the fleet tab has no selected unit", () => {
    expect(
      resolveGrrRepo({
        fleetTabActive: true,
        selectedUnitRepo: null,
        workspaceCwd: "/home/me/workspace",
      }),
    ).toBe("/home/me/workspace");
  });

  it("ignores a selected unit when the active tab is not a fleet tab", () => {
    expect(
      resolveGrrRepo({
        fleetTabActive: false,
        selectedUnitRepo: "/home/me/unit-repo",
        workspaceCwd: "/home/me/workspace",
      }),
    ).toBe("/home/me/workspace");
  });

  it("returns null when neither a unit nor a workspace is known", () => {
    expect(
      resolveGrrRepo({
        fleetTabActive: false,
        selectedUnitRepo: null,
        workspaceCwd: null,
      }),
    ).toBeNull();
  });
});
