import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLazyStoreRegistry } from "@/modules/migrations/lazyStoreFake";

const registry = new FakeLazyStoreRegistry();

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: registry.LazyStoreCtor,
}));

const NEW_PATH = "glance-ai-sessions.json";
const OLD_PATH = "terax-ai-sessions.json";

let sessionsMod: typeof import("./sessions");

beforeEach(async () => {
  registry.reset();
  vi.resetModules();
  sessionsMod = await import("./sessions");
});

describe("sessions store migration", () => {
  it("migrates the legacy sessions list and messages on first load", async () => {
    registry.seed(OLD_PATH, {
      sessions: [{ id: "s1", title: "Old chat", createdAt: 1, updatedAt: 1 }],
      activeId: "s1",
      "messages:s1": [{ id: "m1", role: "user", parts: [] }],
    });
    const loaded = await sessionsMod.loadAll();
    expect(loaded.activeId).toBe("s1");
    expect(loaded.sessions).toEqual([
      { id: "s1", title: "Old chat", createdAt: 1, updatedAt: 1 },
    ]);
    expect(await sessionsMod.loadMessages("s1")).toEqual([
      { id: "m1", role: "user", parts: [] },
    ]);
    expect(registry.snapshot(OLD_PATH)).toEqual({});
    // The copy landed durably in the new store's own file.
    expect(registry.snapshot(NEW_PATH).activeId).toBe("s1");
  });

  it("a save before any load doesn't orphan legacy sessions (poison-write regression)", async () => {
    registry.seed(OLD_PATH, {
      sessions: [{ id: "s1", title: "Old chat", createdAt: 1, updatedAt: 1 }],
      activeId: "s1",
    });
    // Simulates a second window (or a save racing the first load's
    // migrate) writing before this process's own load ever ran.
    await sessionsMod.saveActiveId("new-session");

    const loaded = await sessionsMod.loadAll();
    // The legacy session must still be there — the early write must not
    // have poisoned the new store into looking already-migrated.
    expect(loaded.sessions).toEqual([
      { id: "s1", title: "Old chat", createdAt: 1, updatedAt: 1 },
    ]);
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });

  it("saveMessages/deleteSessionData before any load also don't orphan legacy data", async () => {
    registry.seed(OLD_PATH, {
      sessions: [{ id: "s1", title: "Old chat", createdAt: 1, updatedAt: 1 }],
      activeId: "s1",
    });
    await sessionsMod.saveMessages("new-session", []);
    await sessionsMod.deleteSessionData("some-other-session");
    const loaded = await sessionsMod.loadAll();
    expect(loaded.sessions).toEqual([
      { id: "s1", title: "Old chat", createdAt: 1, updatedAt: 1 },
    ]);
  });
});
