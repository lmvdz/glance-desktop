import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLazyStoreRegistry } from "@/modules/migrations/lazyStoreFake";
import type { Theme } from "./types";

const registry = new FakeLazyStoreRegistry();

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: registry.LazyStoreCtor,
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

const NEW_PATH = "glance-custom-themes.json";
const OLD_PATH = "terax-custom-themes.json";

let customThemesMod: typeof import("./customThemes");

beforeEach(async () => {
  registry.reset();
  vi.resetModules();
  customThemesMod = await import("./customThemes");
});

describe("customThemes store migration", () => {
  const legacyTheme: Theme = { id: "t1", name: "Old theme", variants: {} };
  const newTheme: Theme = { id: "t2", name: "New theme", variants: {} };

  it("migrates legacy custom themes on first load", async () => {
    registry.seed(OLD_PATH, { themes: [legacyTheme] });
    const themes = await customThemesMod.listCustomThemes();
    expect(themes).toEqual([legacyTheme]);
    expect(registry.snapshot(OLD_PATH)).toEqual({});
    // The copy landed durably in the new store's own file.
    expect(registry.snapshot(NEW_PATH).themes).toEqual([legacyTheme]);
  });

  it("a save before any load still runs the migration to completion (poison-write regression)", async () => {
    // Like snippets, custom themes are a single whole-list key, so
    // `saveCustomTheme` legitimately produces a list containing both the
    // legacy and new theme (it appends/replaces by id) — but only if the
    // migration actually ran first. Assert on the legacy file directly:
    // if the save had reached the store ahead of the migrate, the legacy
    // file would be permanently stranded instead of cleared.
    registry.seed(OLD_PATH, { themes: [legacyTheme] });
    await customThemesMod.saveCustomTheme(newTheme);

    expect(registry.snapshot(OLD_PATH)).toEqual({});
    const themes = await customThemesMod.listCustomThemes();
    expect(themes.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });
});
