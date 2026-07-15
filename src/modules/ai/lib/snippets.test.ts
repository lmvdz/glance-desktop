import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLazyStoreRegistry } from "@/modules/migrations/lazyStoreFake";

const registry = new FakeLazyStoreRegistry();

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: registry.LazyStoreCtor,
}));

const NEW_PATH = "glance-ai-snippets.json";
const OLD_PATH = "terax-ai-snippets.json";

let snippetsMod: typeof import("./snippets");

beforeEach(async () => {
  registry.reset();
  vi.resetModules();
  snippetsMod = await import("./snippets");
});

describe("snippets store migration", () => {
  it("migrates legacy snippets on first load", async () => {
    registry.seed(OLD_PATH, {
      snippets: [
        { id: "sn1", handle: "old", name: "Old", description: "", content: "x" },
      ],
    });
    const loaded = await snippetsMod.loadSnippets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].handle).toBe("old");
    expect(registry.snapshot(OLD_PATH)).toEqual({});
    // The copy landed durably in the new store's own file.
    expect(registry.snapshot(NEW_PATH).snippets).toHaveLength(1);
  });

  it("a save before any load still runs the migration to completion (poison-write regression)", async () => {
    // Snippets has a single whole-list key, so `saveSnippets` legitimately
    // overwrites it — that's expected full-list-replace semantics, not the
    // bug. What must NOT happen is the migration being skipped entirely: if
    // `saveSnippets` reached the store before `ensureMigrated` ran, the new
    // store would look "already populated" and the legacy file would be
    // stranded forever (never read, never cleared). Assert on the legacy
    // file directly to tell those two outcomes apart.
    registry.seed(OLD_PATH, {
      snippets: [
        { id: "sn1", handle: "old", name: "Old", description: "", content: "x" },
      ],
    });
    await snippetsMod.saveSnippets([
      { id: "sn2", handle: "new", name: "New", description: "", content: "y" },
    ]);

    expect(registry.snapshot(OLD_PATH)).toEqual({}); // migration ran to completion
    const loaded = await snippetsMod.loadSnippets();
    expect(loaded.map((s) => s.handle)).toEqual(["new"]); // save's overwrite is expected
  });
});
