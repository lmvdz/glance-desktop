import type { LazyStore } from "@tauri-apps/plugin-store";
import { createMigrationGate } from "./migrationGate";

/**
 * Pure decision for a whole-file Tauri store migration: copy every entry
 * from the old store to the new one only when the new store is still empty
 * (a bare "already migrated / fresh install with new data" check), and only
 * when the old store actually has something to give it. Never merges or
 * partially overwrites — the new store's presence of ANY entry wins outright,
 * matching the localStorage/keyring "new key wins" rule at the granularity
 * a whole store file allows.
 */
export type LazyStoreMigrationPlan<T> = {
  shouldMigrate: boolean;
  entriesToWrite: ReadonlyArray<[string, T]>;
};

export function planLazyStoreMigration<T>(
  newEntries: ReadonlyArray<[string, T]>,
  oldEntries: ReadonlyArray<[string, T]>,
): LazyStoreMigrationPlan<T> {
  if (newEntries.length > 0 || oldEntries.length === 0) {
    return { shouldMigrate: false, entriesToWrite: [] };
  }
  return { shouldMigrate: true, entriesToWrite: oldEntries };
}

/**
 * IO wrapper: reads both stores, applies `planLazyStoreMigration`, and — if
 * migration is warranted — copies every old entry into `newStore`, saves it
 * ONCE, then best-effort clears the old store now that the new one durably
 * has the data (never the other way around: the old store is only ever
 * touched after the new store's `save()` resolves).
 *
 * Opening a `LazyStore` for a path that has no file on disk does not create
 * one — Tauri's store plugin only writes on `save()` — so probing the old
 * path on a fresh install costs one no-op IPC roundtrip and leaves no trace.
 *
 * Memoized per new-store path as an in-flight PROMISE (via
 * `createMigrationGate`), not a "started" flag: every entrypoint of the
 * module that owns this store — every load *and every save/delete* — must
 * call this and await the result before touching `newStore` itself. A
 * "started" boolean marked before the migration's own await settles would
 * let a concurrent write (a second window, or a save that races the first
 * load's migrate) slip a key into the new store while the copy is still in
 * flight; the next check of "is the new store non-empty" would then see
 * that poison write and skip copying the rest of the legacy data forever.
 * Sharing one promise across every caller closes that race by construction
 * — no caller can proceed until the single migration attempt has actually
 * finished (or failed and been retried).
 */
const gates = new Map<string, () => Promise<void>>();

export function migrateLazyStoreOnce(
  newStore: LazyStore,
  newStorePath: string,
  oldStorePath: string,
): Promise<void> {
  let gate = gates.get(newStorePath);
  if (!gate) {
    gate = createMigrationGate(() => runMigration(newStore, oldStorePath));
    gates.set(newStorePath, gate);
  }
  return gate();
}

async function runMigration(
  newStore: LazyStore,
  oldStorePath: string,
): Promise<void> {
  const newEntries = await newStore.entries<unknown>();
  if (newEntries.length > 0) return; // new store already has data — never overwrite
  const { LazyStore: LazyStoreCtor } = await import("@tauri-apps/plugin-store");
  const oldStore = new LazyStoreCtor(oldStorePath, {
    defaults: {},
    autoSave: false,
  });
  const oldEntries = await oldStore.entries<unknown>();
  const plan = planLazyStoreMigration(newEntries, oldEntries);
  if (!plan.shouldMigrate) return;
  for (const [key, value] of plan.entriesToWrite) {
    await newStore.set(key, value);
  }
  await newStore.save();
  // Best-effort: only clear the old store once the new one is durably
  // written. If this fails, the data still lives safely in the new store —
  // the old file just lingers (harmless; it will never be read again since
  // the new store is now non-empty).
  try {
    await oldStore.clear();
    await oldStore.save();
  } catch {
    /* not fatal */
  }
}
