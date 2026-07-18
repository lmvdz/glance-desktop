// Transcript prewarm cache (t3-face concern 05, approach step 3 / DESIGN.md's <100ms switch
// budget). Ports t3's constant + slice-the-visible-order shape (Sidebar.logic.ts
// `SIDEBAR_THREAD_PREWARM_LIMIT = 10` / `getSidebarThreadIdsToPrewarm`, MIT) against glance's own
// roster + transcript wire shapes — t3's helper is a one-line `.slice(0, limit)` over its own
// thread-id array; there's nothing there to port verbatim, only the constant and the idea "warm
// the top-N visible rows so a click doesn't start cold."
//
// A module-level cache (mirrors the roster/transcript stores' own module-level poll state) so it
// survives ThreadSpine re-renders and is readable from fleetTranscriptStore.ts without threading a
// prop through the selection path.

import type { FleetClient } from "../../lib/fleetClient";
import {
  type FleetUnit,
  sortUnits,
  unitKey,
} from "../../lib/fleetRoster";
import {
  type TranscriptEntry,
  normalizeTranscript,
} from "../../lib/fleetTranscript";

/** t3's Sidebar.logic.ts `SIDEBAR_THREAD_PREWARM_LIMIT`. Our "visible order" is `sortUnits`
 *  (attention rank, then name) rather than t3's rendered-row order, so this naturally warms the
 *  top-N attention units first and, once attention count < N, extends to the next most-relevant
 *  units — the same fallback behavior t3's prewarm has for a quiet thread list, not a new ranking. */
export const SPINE_PREWARM_LIMIT = 10;

/** Skip re-fetching a unit whose cache entry is younger than this — keeps N one-shot fetches from
 *  stacking on every ~2s roster poll cycle. Deliberately looser than the roster poll interval. */
const MIN_REFETCH_MS = 4000;

interface CacheEntry {
  entries: TranscriptEntry[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** The prewarmed transcript for a unit (keyed by `unitKey`), if any — consumed by
 *  `fleetTranscriptStore.start()` to seed a fresh selection instead of painting an empty pane
 *  while the first poll is in flight. */
export function getPrewarmedTranscript(
  key: string,
): TranscriptEntry[] | undefined {
  return cache.get(key)?.entries;
}

/**
 * Fetch (one-shot, no `since` — a full snapshot) the transcript for the top-N units in roster
 * order. Skips `skipKey` (the currently-selected unit already has its own live poll loop in
 * fleetTranscriptStore via the running-floor cursor; a second concurrent fetch here would just
 * race it) and anything fetched within `MIN_REFETCH_MS`. A per-unit fetch failure is swallowed —
 * prewarm is a latency optimization, never a fleet-wide dependency — and leaves any previous cache
 * entry for that unit in place.
 */
export async function prewarmTopUnits(
  units: FleetUnit[],
  opts: {
    limit?: number;
    skipKey?: string | null;
    client: (daemonId: string) => Promise<FleetClient>;
  },
): Promise<void> {
  const limit = opts.limit ?? SPINE_PREWARM_LIMIT;
  const targets = sortUnits(units).slice(0, Math.max(0, limit));
  const now = Date.now();
  await Promise.all(
    targets.map(async (u) => {
      const key = unitKey(u);
      if (key === opts.skipKey) return;
      const cached = cache.get(key);
      if (cached && now - cached.fetchedAt < MIN_REFETCH_MS) return;
      try {
        const client = await opts.client(u.daemonId);
        const raw = await client.transcript(u.id);
        cache.set(key, {
          entries: normalizeTranscript(raw),
          fetchedAt: Date.now(),
        });
      } catch {
        // A prewarm miss just means that unit's switch isn't instant — never fatal.
      }
    }),
  );
}

/** Test-only reset — the cache is module-level (one per app), like the roster/transcript stores. */
export function __resetPrewarmCacheForTests(): void {
  cache.clear();
}
