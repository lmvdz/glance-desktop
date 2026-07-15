import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLazyStoreRegistry } from "@/modules/migrations/lazyStoreFake";

const registry = new FakeLazyStoreRegistry();

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: registry.LazyStoreCtor,
}));

const NEW_PATH = "glance-spaces.json";
const OLD_PATH = "terax-spaces.json";

let storeMod: typeof import("./store");

beforeEach(async () => {
  registry.reset();
  vi.resetModules();
  storeMod = await import("./store");
});

describe("spaces store migration", () => {
  it("migrates legacy spaces, active id, and per-space state on first load", async () => {
    registry.seed(OLD_PATH, {
      spaces: [
        {
          id: "sp1",
          name: "Old space",
          root: null,
          env: "local",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeId: "sp1",
      "state:sp1": { tabs: [], activeTabIndex: 0 },
    });
    const loaded = await storeMod.loadAll();
    expect(loaded.activeId).toBe("sp1");
    expect(loaded.spaces).toHaveLength(1);
    expect(loaded.states.get("sp1")).toEqual({ tabs: [], activeTabIndex: 0 });
    expect(registry.snapshot(OLD_PATH)).toEqual({});
    // The copy landed durably in the new store's own file.
    expect(registry.snapshot(NEW_PATH).activeId).toBe("sp1");
  });

  it("a save before any load doesn't orphan legacy spaces (poison-write regression)", async () => {
    registry.seed(OLD_PATH, {
      spaces: [
        {
          id: "sp1",
          name: "Old space",
          root: null,
          env: "local",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeId: "sp1",
    });
    // Second-window / boot-race write reaching the store before this
    // process's own load ever ran.
    await storeMod.saveActiveId("brand-new-space");

    const loaded = await storeMod.loadAll();
    expect(loaded.spaces).toHaveLength(1);
    expect(loaded.spaces[0].id).toBe("sp1");
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });

  it("saveState/deleteSpaceData before any load also don't orphan legacy data", async () => {
    registry.seed(OLD_PATH, {
      spaces: [
        {
          id: "sp1",
          name: "Old space",
          root: null,
          env: "local",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeId: "sp1",
    });
    await storeMod.saveState("new-space", { tabs: [], activeTabIndex: 0 });
    await storeMod.deleteSpaceData("some-other-space");
    const loaded = await storeMod.loadAll();
    expect(loaded.spaces).toHaveLength(1);
  });
});
