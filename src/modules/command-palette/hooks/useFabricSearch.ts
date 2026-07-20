import { type FabricHit, useFleetConnection } from "@/modules/fleet";
import { useCallback } from "react";
import { type AsyncQueryState, useAsyncQuery } from "./useAsyncQuery";

// Fleet knowledge-base search for the `@` palette mode (C4). Mirrors useContentSearch's shape
// (debounced query, loading/empty/error via useAsyncQuery) but the transport is the ACTIVE
// daemon's REST surface instead of a local Tauri command — comprehension binds to whichever
// daemon the connection store has active. When no daemon is connected the hook stays disabled
// (empty, no loading), so the palette degrades gracefully rather than firing doomed requests.

export const FABRIC_SEARCH_MIN_QUERY = 2;
const TOP_K = 20;
const DEBOUNCE_MS = 200;

export function useFabricSearch(
  term: string,
  enabled: boolean,
): AsyncQueryState<FabricHit> {
  const getClient = useFleetConnection((s) => s.client);
  const activeId = useFleetConnection((s) => s.activeId);

  const run = useCallback(
    async (q: string): Promise<FabricHit[]> => {
      if (!activeId) return [];
      const client = await getClient();
      return client.fabricSearch(q, { topK: TOP_K });
    },
    [getClient, activeId],
  );

  return useAsyncQuery({
    enabled: enabled && !!activeId,
    term,
    minLength: FABRIC_SEARCH_MIN_QUERY,
    debounceMs: DEBOUNCE_MS,
    run,
  });
}
