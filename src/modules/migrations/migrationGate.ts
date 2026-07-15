/**
 * Generic in-flight-promise memoization for a one-time, idempotent async
 * migration. Every caller — read AND write entrypoints alike — must call
 * the SAME gate function and await its result before touching the
 * migrated resource.
 *
 * This closes the "poison write" race a simple "done" boolean/Set cannot:
 * marking "done" before the migration's own promise settles lets a
 * concurrent caller observe "migrated" and act on a store the migration
 * hasn't actually finished copying into yet. Memoizing the PROMISE instead
 * means every caller — however many arrive while the migration is still
 * running — awaits the exact same attempt, so none of them can slip a
 * write in before it resolves.
 *
 * On failure the memo is cleared (never cached as success) so the next
 * caller in this process retries instead of the source data staying
 * permanently stranded. `run` should let genuinely migration-blocking
 * errors (a read/write that didn't happen) propagate to this gate; purely
 * cosmetic cleanup steps (e.g. best-effort deletion of the old source
 * after the new one durably has the data) should keep swallowing their
 * own failures, since those are not fatal to the migration having
 * succeeded.
 */
export function createMigrationGate(
  run: () => Promise<void>,
): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return function ensureMigrated(): Promise<void> {
    if (inFlight) return inFlight;
    const attempt: Promise<void> = run().catch(() => {
      // Best-effort: never let a failed migration block the caller, but
      // don't cache the failure as "done" either — clear the memo so the
      // next call in this process retries instead of silently giving up
      // forever.
      if (inFlight === attempt) inFlight = null;
    });
    inFlight = attempt;
    return attempt;
  };
}
