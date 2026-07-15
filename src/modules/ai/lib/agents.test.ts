import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLazyStoreRegistry } from "@/modules/migrations/lazyStoreFake";

const registry = new FakeLazyStoreRegistry();

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: registry.LazyStoreCtor,
}));

const NEW_PATH = "glance-ai-agents.json";
const OLD_PATH = "terax-ai-agents.json";

let agentsMod: typeof import("./agents");

beforeEach(async () => {
  registry.reset();
  vi.resetModules();
  agentsMod = await import("./agents");
});

describe("agents store migration", () => {
  it("migrates legacy custom agents on first load", async () => {
    registry.seed(OLD_PATH, {
      customAgents: [
        {
          id: "a1",
          name: "Legacy",
          description: "d",
          instructions: "i",
          icon: "coder",
          builtIn: false,
        },
      ],
      activeAgentId: "a1",
    });
    const loaded = await agentsMod.loadAgents();
    expect(loaded.activeId).toBe("a1");
    expect(loaded.custom).toHaveLength(1);
    expect(loaded.custom[0].name).toBe("Legacy");
    expect(registry.snapshot(OLD_PATH)).toEqual({});
    // The copy landed durably in the new store's own file, not just in
    // what `loadAgents` happens to report back.
    expect(registry.snapshot(NEW_PATH).activeAgentId).toBe("a1");
  });

  it("a save before any load doesn't orphan legacy agents (poison-write regression)", async () => {
    registry.seed(OLD_PATH, {
      customAgents: [
        {
          id: "a1",
          name: "Legacy",
          description: "d",
          instructions: "i",
          icon: "coder",
          builtIn: false,
        },
      ],
      activeAgentId: "a1",
    });
    // Save reaches the store before this process's own load ever ran —
    // must not "poison" the new store into skipping the copy.
    await agentsMod.saveActiveAgentId("builtin:coder");

    const loaded = await agentsMod.loadAgents();
    expect(loaded.custom).toHaveLength(1);
    expect(loaded.custom[0].name).toBe("Legacy");
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });

  it("does nothing when there's no legacy data (fresh install)", async () => {
    await agentsMod.saveActiveAgentId("builtin:architect");
    const loaded = await agentsMod.loadAgents();
    expect(loaded.activeId).toBe("builtin:architect");
    expect(loaded.custom).toEqual([]);
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });
});
