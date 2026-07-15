import { describe, expect, it } from "vitest";
import { planLazyStoreMigration } from "./lazyStoreMigration";

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
