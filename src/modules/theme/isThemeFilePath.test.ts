import { describe, expect, it } from "vitest";
import { isThemeFilePath } from "./themeFiles";

describe("isThemeFilePath", () => {
  it("accepts the current .glance-theme extension", () => {
    expect(isThemeFilePath("/home/me/themes/my-theme.glance-theme")).toBe(true);
  });

  it("still accepts the pre-rename .terax-theme extension (back-compat)", () => {
    expect(isThemeFilePath("/home/me/themes/my-theme.terax-theme")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isThemeFilePath("MyTheme.GLANCE-THEME")).toBe(true);
    expect(isThemeFilePath("MyTheme.TERAX-THEME")).toBe(true);
  });

  it("rejects unrelated extensions", () => {
    expect(isThemeFilePath("notes.json")).toBe(false);
    expect(isThemeFilePath("readme.md")).toBe(false);
  });
});
