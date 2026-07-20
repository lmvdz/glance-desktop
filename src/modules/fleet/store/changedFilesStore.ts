import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Changed-files card preferences (hub-shell H3, r3 borrow 1) — whether the card is collapsed,
 * keyed per `unitKey` (`daemonId:id`, M02's disambiguation) and persisted so a re-visit keeps
 * your fold, matching t3code's per-thread persisted expand state (uiStateStore.ts, © 2026 T3
 * Tools Inc., MIT License). Default is EXPANDED (t3's default): only an explicit collapse is
 * stored. Per-file diff expansion and per-directory collapse stay component state — restoring
 * heavy diff renders on boot would cost more than it saves.
 */

export const CHANGED_FILES_STORE_VERSION = 1;
export const CHANGED_FILES_STORE_NAME = "glance-fleet-changed-files";

type PersistedShape = { collapsedCards: Record<string, true> };

type ChangedFilesState = {
  collapsedCards: Record<string, true>;
  setCardCollapsed: (unitKey: string, collapsed: boolean) => void;
};

export const useChangedFilesStore = create<ChangedFilesState>()(
  persist(
    (set) => ({
      collapsedCards: {},
      setCardCollapsed: (unitKey, collapsed) =>
        set((s) => {
          if (collapsed) {
            if (s.collapsedCards[unitKey]) return s;
            return { collapsedCards: { ...s.collapsedCards, [unitKey]: true } };
          }
          if (!(unitKey in s.collapsedCards)) return s;
          const next = { ...s.collapsedCards };
          delete next[unitKey];
          return { collapsedCards: next };
        }),
    }),
    {
      name: CHANGED_FILES_STORE_NAME,
      version: CHANGED_FILES_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ collapsedCards: state.collapsedCards }),
      migrate: (persisted): PersistedShape => {
        const p = persisted as Partial<PersistedShape> | undefined;
        return { collapsedCards: p?.collapsedCards ?? {} };
      },
    },
  ),
);
