/**
 * Pure decision logic for a single-value read-old-write-new migration
 * (localStorage keys, keyring accounts): the new key wins if it already has
 * data, otherwise the old value is copied over and the old key is cleared.
 * Idempotent — once the new key is populated, a second run is a no-op.
 *
 * Kept separate from any I/O so it can be unit-tested without a DOM,
 * localStorage, or the Tauri keyring bridge.
 */
export type KeyValueMigrationPlan<T> = {
  /** The value callers should use going forward (new if present, else old). */
  value: T | null;
  /** Whether the new key needs to be written. */
  shouldWriteNew: boolean;
  /** Whether the old key should be cleared (only once the new write lands). */
  shouldDeleteOld: boolean;
};

export function planKeyValueMigration<T>(
  newValue: T | null,
  oldValue: T | null,
): KeyValueMigrationPlan<T> {
  if (newValue !== null) {
    // Already migrated (or a fresh install that wrote the new key directly).
    return { value: newValue, shouldWriteNew: false, shouldDeleteOld: false };
  }
  if (oldValue === null) {
    return { value: null, shouldWriteNew: false, shouldDeleteOld: false };
  }
  return { value: oldValue, shouldWriteNew: true, shouldDeleteOld: true };
}
