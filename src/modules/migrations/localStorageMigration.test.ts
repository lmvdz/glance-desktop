import { describe, expect, it } from "vitest";
import { migrateLocalStorageKey, type KVStorage } from "./localStorageMigration";

function fakeStorage(initial: Record<string, string> = {}): KVStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("migrateLocalStorageKey", () => {
  it("carries the old value to the new key and removes the old one", () => {
    const storage = fakeStorage({ "terax-key": "hello" });
    const value = migrateLocalStorageKey(storage, "terax-key", "glance-key");
    expect(value).toBe("hello");
    expect(storage.getItem("glance-key")).toBe("hello");
    expect(storage.getItem("terax-key")).toBeNull();
  });

  it("is idempotent — running twice is a no-op the second time", () => {
    const storage = fakeStorage({ "terax-key": "hello" });
    migrateLocalStorageKey(storage, "terax-key", "glance-key");
    const secondRun = migrateLocalStorageKey(storage, "terax-key", "glance-key");
    expect(secondRun).toBe("hello");
    expect(storage.getItem("glance-key")).toBe("hello");
    expect(storage.getItem("terax-key")).toBeNull();
  });

  it("new-key-wins when both keys already have data", () => {
    const storage = fakeStorage({
      "terax-key": "old",
      "glance-key": "already-new",
    });
    const value = migrateLocalStorageKey(storage, "terax-key", "glance-key");
    expect(value).toBe("already-new");
    // Old key is left untouched — we only ever clear it after copying it.
    expect(storage.getItem("terax-key")).toBe("old");
  });

  it("returns null when neither key exists (fresh install)", () => {
    const storage = fakeStorage();
    const value = migrateLocalStorageKey(storage, "terax-key", "glance-key");
    expect(value).toBeNull();
    expect(storage.getItem("glance-key")).toBeNull();
  });
});
