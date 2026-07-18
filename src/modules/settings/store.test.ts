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

const DEFAULT_THEME_ID = "glance-default";
const LEGACY_DEFAULT_THEME_ID = "terax-default";

describe("t3-face one-time theme reset migration", () => {
  it("fresh install on the default: stamps the flag, no reset, nothing recorded", async () => {
    const prefs = await settingsMod.loadPreferences();
    expect(prefs.themeId).toBe(DEFAULT_THEME_ID);
    expect(prefs.themeIdBeforeT3face).toBeNull();
    // The flag is stamped so it never runs again.
    expect(registry.snapshot(NEW_PATH).t3faceThemeReset).toBe(true);
    expect(registry.snapshot(NEW_PATH).themeIdBeforeT3face).toBeUndefined();
  });

  it("upgrade with a persisted builtin theme: resets the selection and records the old id", async () => {
    registry.seed(NEW_PATH, { themeId: "dracula" });
    const prefs = await settingsMod.loadPreferences();
    expect(prefs.themeId).toBe(DEFAULT_THEME_ID); // t3-face skin now shows
    expect(prefs.themeIdBeforeT3face).toBe("dracula"); // preserved for opt-back
    const snap = registry.snapshot(NEW_PATH);
    expect(snap.themeId).toBe(DEFAULT_THEME_ID);
    expect(snap.themeIdBeforeT3face).toBe("dracula");
    expect(snap.t3faceThemeReset).toBe(true);
  });

  it("upgrade with a persisted custom theme: resets and records it (the custom theme itself is untouched)", async () => {
    registry.seed(NEW_PATH, { themeId: "custom-abc123" });
    const prefs = await settingsMod.loadPreferences();
    expect(prefs.themeId).toBe(DEFAULT_THEME_ID);
    expect(prefs.themeIdBeforeT3face).toBe("custom-abc123");
  });

  it("a persisted legacy-default id is treated as the default: flag stamped, no reset", async () => {
    registry.seed(NEW_PATH, { themeId: LEGACY_DEFAULT_THEME_ID });
    const prefs = await settingsMod.loadPreferences();
    expect(prefs.themeId).toBe(DEFAULT_THEME_ID);
    expect(prefs.themeIdBeforeT3face).toBeNull();
    expect(registry.snapshot(NEW_PATH).t3faceThemeReset).toBe(true);
  });

  it("second boot after a reset is a no-op (default stays, recorded id preserved)", async () => {
    registry.seed(NEW_PATH, {
      themeId: DEFAULT_THEME_ID,
      themeIdBeforeT3face: "dracula",
      t3faceThemeReset: true,
    });
    const prefs = await settingsMod.loadPreferences();
    expect(prefs.themeId).toBe(DEFAULT_THEME_ID);
    expect(prefs.themeIdBeforeT3face).toBe("dracula");
  });

  it("a user who re-picks their old theme after the migration keeps it (flag prevents re-reset)", async () => {
    registry.seed(NEW_PATH, {
      themeId: "dracula", // re-selected post-migration
      themeIdBeforeT3face: "dracula",
      t3faceThemeReset: true,
    });
    const prefs = await settingsMod.loadPreferences();
    expect(prefs.themeId).toBe("dracula"); // respected, not reset again
  });

  it("is idempotent within a process: a second load never re-runs the reset", async () => {
    registry.seed(NEW_PATH, { themeId: "dracula" });
    await settingsMod.loadPreferences(); // resets, records dracula
    // Simulate the user re-picking their old theme in the same session.
    await settingsMod.setThemeId("dracula");
    const prefs = await settingsMod.loadPreferences(); // must not reset again
    expect(prefs.themeId).toBe("dracula");
    expect(prefs.themeIdBeforeT3face).toBe("dracula");
  });
});
