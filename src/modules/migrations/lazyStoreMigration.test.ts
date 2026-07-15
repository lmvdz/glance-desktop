import type { LazyStore } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLazyStoreRegistry } from "./lazyStoreFake";

const registry = new FakeLazyStoreRegistry();

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: registry.LazyStoreCtor,
}));

const { planLazyStoreMigration } = await import("./lazyStoreMigration");

describe("planLazyStoreMigration", () => {
  it("migrates every old entry when the new store is empty", () => {
    const oldEntries: Array<[string, unknown]> = [
      ["sessions", ["s1", "s2"]],
      ["activeId", "s1"],
    ];
    const plan = planLazyStoreMigration([], oldEntries);
    expect(plan.shouldMigrate).toBe(true);
    expect(plan.entriesToWrite).toBe(oldEntries);
  });

  it("does nothing when the new store already has data (new wins)", () => {
    const plan = planLazyStoreMigration(
      [["sessions", ["fresh"]]],
      [["sessions", ["legacy"]]],
    );
    expect(plan).toEqual({ shouldMigrate: false, entriesToWrite: [] });
  });

  it("does nothing when the old store is empty (fresh install)", () => {
    const plan = planLazyStoreMigration([], []);
    expect(plan).toEqual({ shouldMigrate: false, entriesToWrite: [] });
  });

  it("is idempotent — once new has data, a second plan is a no-op", () => {
    const oldEntries: Array<[string, unknown]> = [["sessions", ["s1"]]];
    const first = planLazyStoreMigration([], oldEntries);
    expect(first.shouldMigrate).toBe(true);
    // Simulate post-migration state: new store now has the copied entries.
    const second = planLazyStoreMigration(first.entriesToWrite, oldEntries);
    expect(second.shouldMigrate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// migrateLazyStoreOnce — the IO wrapper (the race/loss bugs live here, not
// in the pure planner above). Each test gets a fresh module instance (via
// resetModules) so the per-path gate memo from one test never leaks into
// the next.
// ---------------------------------------------------------------------------
describe("migrateLazyStoreOnce (IO wrapper)", () => {
  const NEW_PATH = "new.json";
  const OLD_PATH = "old.json";

  /** The fake's instances are structurally compatible with `LazyStore` for
   *  everything `migrateLazyStoreOnce` actually calls; cast at the
   *  boundary rather than widening the fake's own type. */
  function asLazyStore(
    instance: InstanceType<typeof registry.LazyStoreCtor>,
  ): LazyStore {
    return instance as unknown as LazyStore;
  }

  let migrateLazyStoreOnce: typeof import("./lazyStoreMigration").migrateLazyStoreOnce;

  beforeEach(async () => {
    registry.reset();
    vi.resetModules();
    ({ migrateLazyStoreOnce } = await import("./lazyStoreMigration"));
  });

  it("copies legacy entries into the new store and clears the old one", async () => {
    registry.seed(OLD_PATH, { a: 1, b: 2 });
    const newStore = asLazyStore(new registry.LazyStoreCtor(NEW_PATH));
    await migrateLazyStoreOnce(newStore, NEW_PATH, OLD_PATH);
    expect(registry.snapshot(NEW_PATH)).toEqual({ a: 1, b: 2 });
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });

  it("never overwrites a new store that already has data", async () => {
    registry.seed(OLD_PATH, { a: "legacy" });
    registry.seed(NEW_PATH, { a: "current" });
    const newStore = asLazyStore(new registry.LazyStoreCtor(NEW_PATH));
    await migrateLazyStoreOnce(newStore, NEW_PATH, OLD_PATH);
    expect(registry.snapshot(NEW_PATH)).toEqual({ a: "current" });
    // Old is left untouched too — it's only ever cleared after a real copy.
    expect(registry.snapshot(OLD_PATH)).toEqual({ a: "legacy" });
  });

  it("concurrent callers share one in-flight attempt instead of racing a second", async () => {
    registry.seed(OLD_PATH, { a: 1 });
    const newStore = asLazyStore(new registry.LazyStoreCtor(NEW_PATH));

    // Hold the copy open mid-flight so we can prove a second concurrent
    // caller is genuinely waiting on the SAME attempt, not short-circuiting
    // past a "started" flag the way the pre-fix code did (which resolved
    // the second caller immediately, before the first had actually copied
    // anything — the exact race that let a write slip in mid-migration).
    let unblock!: () => void;
    const blocker = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const originalSet = newStore.set.bind(newStore);
    const setSpy = vi.fn(async (key: string, value: unknown) => {
      await blocker;
      return originalSet(key, value);
    });
    newStore.set = setSpy;

    let secondResolved = false;
    const first = migrateLazyStoreOnce(newStore, NEW_PATH, OLD_PATH);
    const second = migrateLazyStoreOnce(newStore, NEW_PATH, OLD_PATH).then(
      () => {
        secondResolved = true;
      },
    );

    // Let both calls run their synchronous-until-first-await prefix
    // (including the "already in flight?" gate check) without releasing
    // the blocked write.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    unblock();
    await Promise.all([first, second]);
    expect(secondResolved).toBe(true);
    expect(registry.snapshot(NEW_PATH)).toEqual({ a: 1 });
    // Exactly one migration attempt ran — the second caller shared it
    // rather than starting an independent copy.
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed attempt instead of caching the failure as done", async () => {
    registry.seed(OLD_PATH, { a: 1 });
    const newStore = asLazyStore(new registry.LazyStoreCtor(NEW_PATH));
    let attempt = 0;
    const realSet = newStore.set.bind(newStore);
    newStore.set = vi.fn(async (key: string, value: unknown) => {
      attempt++;
      if (attempt === 1) throw new Error("simulated IPC failure");
      return realSet(key, value);
    });

    await migrateLazyStoreOnce(newStore, NEW_PATH, OLD_PATH); // fails, swallowed (best-effort)
    expect(registry.snapshot(NEW_PATH)).toEqual({}); // nothing written — not cached as "done"
    expect(registry.snapshot(OLD_PATH)).toEqual({ a: 1 }); // old untouched by the failed attempt

    await migrateLazyStoreOnce(newStore, NEW_PATH, OLD_PATH); // retries, this time succeeds
    expect(registry.snapshot(NEW_PATH)).toEqual({ a: 1 });
    expect(registry.snapshot(OLD_PATH)).toEqual({});
  });
});
