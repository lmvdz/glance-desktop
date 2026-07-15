import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLazyStoreRegistry } from "@/modules/migrations/lazyStoreFake";

const registry = new FakeLazyStoreRegistry();

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: registry.LazyStoreCtor,
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

const NEW_PATH = "glance-settings.json";
const OLD_PATH = "terax-settings.json";

let settingsMod: typeof import("./store");

beforeEach(async () => {
  registry.reset();
  vi.resetModules();
  settingsMod = await import("./store");
});

describe("settings store migration", () => {
  it("migrates legacy preferences on first load", async () => {
    registry.seed(OLD_PATH, {
      customInstructions: "old instructions",
      vimMode: true,
    });
    const prefs = await settingsMod.loadPreferences();
    expect(prefs.customInstructions).toBe("old instructions");
    expect(prefs.vimMode).toBe(true);
    expect(registry.snapshot(OLD_PATH)).toEqual({});
    // The copy landed durably in the new store's own file.
    expect(registry.snapshot(NEW_PATH).customInstructions).toBe(
      "old instructions",
    );
  });

  it("a setter call before any load doesn't orphan other legacy preferences (poison-write regression)", async () => {
    registry.seed(OLD_PATH, {
      customInstructions: "old instructions",
      vimMode: true,
    });
    // `writePref` (the single funnel every setter goes through) reaches the
    // store before `loadPreferences`'s migrate ever ran — the exact boot
    // race grok found. This setter only ever writes `theme`; every OTHER
    // legacy preference must still show up afterward.
    await settingsMod.setTheme("dark");

    const prefs = await settingsMod.loadPreferences();
    expect(prefs.theme).toBe("dark"); // the user's explicit set wins, as expected
    expect(prefs.customInstructions).toBe("old instructions"); // not orphaned
    expect(prefs.vimMode).toBe(true); // not orphaned
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });

  it("setLspActivation's own direct read is also gated (poison-write regression)", async () => {
    registry.seed(OLD_PATH, {
      customInstructions: "old instructions",
    });
    await settingsMod.setLspActivation("typescript", "enabled");

    const prefs = await settingsMod.loadPreferences();
    expect(prefs.customInstructions).toBe("old instructions");
    expect(prefs.lspActivation).toEqual({ typescript: "enabled" });
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });

  it("does nothing when there's no legacy data (fresh install)", async () => {
    await settingsMod.setVimMode(true);
    const prefs = await settingsMod.loadPreferences();
    expect(prefs.vimMode).toBe(true);
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });
});
