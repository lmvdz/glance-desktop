import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  LEGACY_DEFAULT_THEME_ID,
  resolveThemeId,
} from "./store";

describe("resolveThemeId", () => {
  it("remaps the pre-rename default theme id to the new default", () => {
    expect(resolveThemeId(LEGACY_DEFAULT_THEME_ID)).toBe(DEFAULT_THEME_ID);
  });

  it("leaves any other stored theme id untouched", () => {
    expect(resolveThemeId("dracula")).toBe("dracula");
    expect(resolveThemeId("some-custom-theme")).toBe("some-custom-theme");
  });

  it("falls back to the default when nothing was stored", () => {
    expect(resolveThemeId(undefined)).toBe(DEFAULT_THEME_ID);
  });

  it("is idempotent — remapping twice gives the same result", () => {
    const once = resolveThemeId(LEGACY_DEFAULT_THEME_ID);
    expect(resolveThemeId(once)).toBe(DEFAULT_THEME_ID);
  });
});
