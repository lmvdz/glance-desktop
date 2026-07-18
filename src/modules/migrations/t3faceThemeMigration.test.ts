import { describe, expect, it } from "vitest";
import { planT3faceThemeMigration } from "./t3faceThemeMigration";

const DEFAULT = "glance-default";

describe("planT3faceThemeMigration", () => {
  it("fresh install on the default: stamps the flag, no reset", () => {
    expect(planT3faceThemeMigration(false, DEFAULT, DEFAULT)).toEqual({
      shouldStampFlag: true,
      shouldReset: false,
      themeIdBefore: null,
    });
  });

  it("upgrade with a persisted builtin theme: resets and records the old id", () => {
    expect(planT3faceThemeMigration(false, "dracula", DEFAULT)).toEqual({
      shouldStampFlag: true,
      shouldReset: true,
      themeIdBefore: "dracula",
    });
  });

  it("upgrade with a persisted custom theme: resets and records the old id", () => {
    expect(planT3faceThemeMigration(false, "custom-abc123", DEFAULT)).toEqual({
      shouldStampFlag: true,
      shouldReset: true,
      themeIdBefore: "custom-abc123",
    });
  });

  it("already migrated: never touches the selection (re-picked old theme sticks)", () => {
    expect(planT3faceThemeMigration(true, "dracula", DEFAULT)).toEqual({
      shouldStampFlag: false,
      shouldReset: false,
      themeIdBefore: null,
    });
  });

  it("already migrated and on default: still a no-op", () => {
    expect(planT3faceThemeMigration(true, DEFAULT, DEFAULT)).toEqual({
      shouldStampFlag: false,
      shouldReset: false,
      themeIdBefore: null,
    });
  });
});
