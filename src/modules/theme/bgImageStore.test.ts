import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Minimal in-memory fake for the small slice of IndexedDB `bgImageStore.ts`
 * actually uses: `databases()`, `open()` (with `onupgradeneeded`), and a
 * single object store supporting `put`/`clear`/`openCursor`. No jsdom /
 * fake-indexeddb dependency is available (and none is being added — see
 * "no new deps"), so this models exactly what's needed, including the
 * real API's most important-to-get-right property for this concern:
 * `indexedDB.open(name, …)` unconditionally CREATES a database that
 * doesn't already exist.
 */
const STORE = "images";

class FakeObjectStore {
  constructor(private readonly data: Map<string, Blob>) {}

  put(value: Blob, key: string): { onsuccess: (() => void) | null } {
    const req: { onsuccess: (() => void) | null } = { onsuccess: null };
    this.data.set(key, value);
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }

  get(key: string): {
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    result: Blob | undefined;
  } {
    const req = {
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      result: undefined as Blob | undefined,
    };
    queueMicrotask(() => {
      req.result = this.data.get(key);
      req.onsuccess?.();
    });
    return req;
  }

  delete(key: string): {
    onsuccess: (() => void) | null;
    oncomplete: (() => void) | null;
  } {
    const req = {
      onsuccess: null as (() => void) | null,
      oncomplete: null as (() => void) | null,
    };
    this.data.delete(key);
    queueMicrotask(() => {
      req.onsuccess?.();
      req.oncomplete?.();
    });
    return req;
  }

  clear(): { onsuccess: (() => void) | null } {
    const req: { onsuccess: (() => void) | null } = { onsuccess: null };
    this.data.clear();
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }

  openCursor(): {
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    result: { key: string; value: Blob; continue: () => void } | null;
  } {
    const entries = Array.from(this.data.entries());
    let i = 0;
    const req = {
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      result: null as { key: string; value: Blob; continue: () => void } | null,
    };
    const step = () => {
      if (i < entries.length) {
        const [key, value] = entries[i++];
        req.result = { key, value, continue: () => queueMicrotask(step) };
      } else {
        req.result = null;
      }
      req.onsuccess?.();
    };
    queueMicrotask(step);
    return req;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor(private readonly db: FakeDatabase) {
    queueMicrotask(() => this.oncomplete?.());
  }

  objectStore(name: string): FakeObjectStore {
    if (this.db.shouldFailTransaction()) {
      throw new Error("simulated IDB transaction failure");
    }
    return new FakeObjectStore(this.db.storeData(name));
  }
}

class FakeDatabase {
  private stores = new Map<string, Map<string, Blob>>();
  onclose: (() => void) | null = null;
  /** Set by a test to make the NEXT `transaction()` call throw once. */
  failTransactionsRemaining = 0;

  get objectStoreNames(): { contains: (name: string) => boolean } {
    const stores = this.stores;
    return { contains: (name: string) => stores.has(name) };
  }

  createObjectStore(name: string): void {
    this.stores.set(name, new Map());
  }

  storeData(name: string): Map<string, Blob> {
    const s = this.stores.get(name);
    if (!s) throw new Error(`no such object store: ${name}`);
    return s;
  }

  shouldFailTransaction(): boolean {
    if (this.failTransactionsRemaining > 0) {
      this.failTransactionsRemaining--;
      return true;
    }
    return false;
  }

  transaction(_name: string, _mode: string): FakeTransaction {
    // Constructing the transaction itself never fails in real IDB from a
    // bad object-store name — `objectStore()` is where a store lookup
    // (and our simulated failure) happens, matching the real API shape
    // `db.transaction(...).objectStore(...)`.
    return new FakeTransaction(this);
  }

  close(): void {
    this.onclose?.();
  }
}

class FakeIndexedDB {
  registry = new Map<string, FakeDatabase>();

  databases = vi.fn(async () =>
    Array.from(this.registry.keys()).map((name) => ({ name, version: 1 })),
  );

  open(name: string, _version: number) {
    const req: {
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
      onupgradeneeded: (() => void) | null;
      onblocked: (() => void) | null;
      result: FakeDatabase | undefined;
      error: unknown;
    } = {
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null,
      result: undefined,
      error: null,
    };
    queueMicrotask(() => {
      let db = this.registry.get(name);
      const isNew = !db;
      if (!db) {
        db = new FakeDatabase();
        this.registry.set(name, db);
      }
      req.result = db;
      if (isNew) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  }

  /** Preseed a database as if it already existed on disk (a real upgrade
   *  scenario), bypassing the app's own open flow entirely. */
  preseed(name: string, entries: Record<string, Blob>): void {
    const db = new FakeDatabase();
    db.createObjectStore(STORE);
    const data = db.storeData(STORE);
    for (const [k, v] of Object.entries(entries)) data.set(k, v);
    this.registry.set(name, db);
  }

  entriesOf(name: string): Record<string, Blob> {
    const db = this.registry.get(name);
    if (!db) return {};
    return Object.fromEntries(db.storeData(STORE));
  }
}

function installFakeIndexedDB(opts?: { withoutDatabases?: boolean }): FakeIndexedDB {
  const fake = new FakeIndexedDB();
  const exposed: Record<string, unknown> = {
    open: fake.open.bind(fake),
  };
  if (!opts?.withoutDatabases) exposed.databases = fake.databases;
  (globalThis as { indexedDB?: unknown }).indexedDB = exposed;
  return fake;
}

const blob = (text: string) => new Blob([text], { type: "text/plain" });

describe("bgImageStore migration", () => {
  const OLD_DB = "terax-bg-images";

  beforeEach(() => {
    vi.resetModules();
  });

  it("never opens/creates the legacy database on a fresh install", async () => {
    const fake = installFakeIndexedDB();
    const { getBgImage } = await import("./bgImageStore");
    await getBgImage("nonexistent");
    expect(fake.registry.has(OLD_DB)).toBe(false);
  });

  it("copies legacy images into the new database and clears the old one", async () => {
    const fake = installFakeIndexedDB();
    fake.preseed(OLD_DB, { img1: blob("legacy-image") });
    const { getBgImage } = await import("./bgImageStore");
    const got = await getBgImage("img1");
    expect(got).not.toBeNull();
    expect(await got?.text()).toBe("legacy-image");
    expect(fake.entriesOf(OLD_DB)).toEqual({});
  });

  it("a put before any get doesn't orphan legacy images (poison-write regression)", async () => {
    const fake = installFakeIndexedDB();
    fake.preseed(OLD_DB, { img1: blob("legacy-image") });
    const { putBgImage, getBgImage } = await import("./bgImageStore");
    // Write reaches the store before this process's own read-triggered
    // migrate ever ran.
    await putBgImage("img2", blob("brand-new-image"));

    const legacy = await getBgImage("img1");
    expect(legacy).not.toBeNull();
    expect(await legacy?.text()).toBe("legacy-image");
    const fresh = await getBgImage("img2");
    expect(await fresh?.text()).toBe("brand-new-image");
  });

  it("without indexedDB.databases(), skips migration rather than blind-opening the legacy name", async () => {
    const fake = installFakeIndexedDB({ withoutDatabases: true });
    fake.preseed(OLD_DB, { img1: blob("legacy-image") });
    const { getBgImage } = await import("./bgImageStore");
    // Even though the legacy DB genuinely exists with data, we can't safely
    // check for it without `databases()`, so we must not touch it — and
    // therefore must not migrate it in either. That's the accepted trade
    // documented in bgImageStore.ts.
    const result = await getBgImage("img1");
    expect(result).toBeNull();
    // The registry access itself must not have been touched beyond what
    // was preseeded (no accidental re-creation/mutation).
    expect(fake.entriesOf(OLD_DB)).toEqual({ img1: expect.any(Blob) });
  });

  it("retries after a failed migration attempt instead of caching the failure as done", async () => {
    const fake = installFakeIndexedDB();
    fake.preseed(OLD_DB, { img1: blob("legacy-image") });
    const legacyDb = fake.registry.get(OLD_DB);
    if (!legacyDb) throw new Error("test setup: legacy db missing");
    // Force the FIRST read of the legacy store to fail (simulated IDB
    // error), then let subsequent attempts succeed.
    legacyDb.failTransactionsRemaining = 1;

    const { getBgImage } = await import("./bgImageStore");
    const first = await getBgImage("img1");
    expect(first).toBeNull(); // migration failed; nothing copied yet
    expect(fake.entriesOf(OLD_DB)).toEqual({ img1: expect.any(Blob) }); // untouched

    const second = await getBgImage("img1"); // retries — this time succeeds
    expect(second).not.toBeNull();
    expect(await second?.text()).toBe("legacy-image");
    expect(fake.entriesOf(OLD_DB)).toEqual({});
  });
});
