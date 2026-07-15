import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLazyStoreRegistry } from "@/modules/migrations/lazyStoreFake";

const registry = new FakeLazyStoreRegistry();

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: registry.LazyStoreCtor,
}));

const NEW_PATH = "glance-ai-todos.json";
const OLD_PATH = "terax-ai-todos.json";

let todosMod: typeof import("./todos");

beforeEach(async () => {
  registry.reset();
  vi.resetModules();
  todosMod = await import("./todos");
});

describe("todos store migration", () => {
  it("migrates legacy todos into the new store on first read", async () => {
    registry.seed(OLD_PATH, {
      "todos:legacy-session": [
        { id: "t1", title: "old todo", status: "pending" },
      ],
    });
    const todos = await todosMod.loadTodos("legacy-session");
    expect(todos).toEqual([{ id: "t1", title: "old todo", status: "pending" }]);
    expect(registry.snapshot(OLD_PATH)).toEqual({}); // cleared once copied
    // The copy landed durably in the new store's own file.
    expect(registry.snapshot(NEW_PATH)["todos:legacy-session"]).toEqual([
      { id: "t1", title: "old todo", status: "pending" },
    ]);
  });

  it("a save before any load doesn't orphan legacy data (poison-write regression)", async () => {
    registry.seed(OLD_PATH, {
      "todos:legacy-session": [
        { id: "t1", title: "old todo", status: "pending" },
      ],
    });
    // The exact race grok found: a write reaches the store before the
    // module's own migrate-on-read path ever runs (a second window, or a
    // save that wins a boot race against the first load). With every
    // write entrypoint gated behind the same migration promise, this must
    // not "poison" the new store into looking already-migrated.
    await todosMod.saveTodos("brand-new-session", [
      { id: "t2", title: "new todo", status: "pending" },
    ]);

    const legacy = await todosMod.loadTodos("legacy-session");
    expect(legacy).toEqual([
      { id: "t1", title: "old todo", status: "pending" },
    ]);
    const fresh = await todosMod.loadTodos("brand-new-session");
    expect(fresh).toEqual([{ id: "t2", title: "new todo", status: "pending" }]);
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });

  it("deleteTodos before any load also doesn't orphan legacy data", async () => {
    registry.seed(OLD_PATH, {
      "todos:legacy-session": [
        { id: "t1", title: "old todo", status: "pending" },
      ],
    });
    await todosMod.deleteTodos("some-other-session");
    const legacy = await todosMod.loadTodos("legacy-session");
    expect(legacy).toEqual([
      { id: "t1", title: "old todo", status: "pending" },
    ]);
  });

  it("does nothing when there's no legacy data (fresh install)", async () => {
    await todosMod.saveTodos("s1", [
      { id: "t1", title: "todo", status: "pending" },
    ]);
    expect(await todosMod.loadTodos("s1")).toEqual([
      { id: "t1", title: "todo", status: "pending" },
    ]);
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });
});
