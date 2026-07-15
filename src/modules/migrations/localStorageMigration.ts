import { planKeyValueMigration } from "./keyValueMigration";

/** Minimal surface of the Web Storage API the migration needs — lets tests
 *  inject an in-memory fake instead of touching real `localStorage`/jsdom. */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Read-old-write-new-and-remove-old localStorage migration, run on every
 * read. New key wins if already populated; otherwise the old value (if any)
 * is copied over and the old key removed. Idempotent by construction (see
 * `planKeyValueMigration`).
 */
export function migrateLocalStorageKey(
  storage: KVStorage,
  oldKey: string,
  newKey: string,
): string | null {
  const plan = planKeyValueMigration(
    storage.getItem(newKey),
    storage.getItem(oldKey),
  );
  if (plan.shouldWriteNew) storage.setItem(newKey, plan.value as string);
  if (plan.shouldDeleteOld) storage.removeItem(oldKey);
  return plan.value;
}

/** Real-`window.localStorage` wrapper — swallows storage errors (private
 *  mode / quota) the same way every other localStorage call site in this
 *  app does, returning the pre-migration old-key read (or null) on failure. */
export function migrateWindowLocalStorageKey(
  oldKey: string,
  newKey: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    return migrateLocalStorageKey(window.localStorage, oldKey, newKey);
  } catch {
    return null;
  }
}
