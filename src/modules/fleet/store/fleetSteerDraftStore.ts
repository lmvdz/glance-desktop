import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Steer-draft persistence — the law-5 fix (plans/t3-face/08-composer-shell.md).
 *
 * IntervenePane's steer textarea used to hold its in-progress text as component
 * state (`useState`). RosterView force-clears the selected unit the instant the
 * unit vanishes from the roster (landed, or otherwise removed) — see
 * `RosterView`'s `select(null)` effect — which unmounts IntervenePane. A
 * half-typed steer instruction was silently destroyed at that moment, with no
 * undo, mid-thought.
 *
 * Moving the text into a store OUTSIDE the component tree (persisted to
 * localStorage, so it survives a full app restart too — a unit can land while
 * the cockpit isn't even open) means IntervenePane just reads/writes this
 * store instead of local state, and unmounting it can never lose anything.
 *
 * Keyed per `unitKey` (`daemonId:id`, matching fleetRoster's disambiguation —
 * M02) so drafts for different units/daemons never collide.
 */

export type SteerDraftsV1 = Record<string, string>;

type PersistedShape = { drafts: SteerDraftsV1 };

/** Bump this — and branch in `migrate` below — the day the persisted shape
 *  changes (e.g. per-draft metadata like a cursor position or updatedAt).
 *  No prior version exists yet (this store is new), so today's migrate is a
 *  documented no-op, not dead code: it's the seam the NEXT shape change
 *  lands in, per t3's own precedent (its composer draft store is at v8). */
export const STEER_DRAFT_STORE_VERSION = 1;

export const STEER_DRAFT_STORE_NAME = "glance-fleet-steer-drafts";

type SteerDraftState = {
  drafts: SteerDraftsV1;
  /** Save (or, for empty text, clear) the in-progress draft for a unit. */
  setDraft: (unitKey: string, text: string) => void;
  /** Explicitly drop a draft (e.g. after a successful send). */
  clearDraft: (unitKey: string) => void;
};

export const useSteerDraftStore = create<SteerDraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (unitKey, text) =>
        set((s) => {
          // An emptied textarea (sent, or cleared by hand) should vanish from
          // storage rather than linger as a "" entry forever.
          if (!text) {
            if (!(unitKey in s.drafts)) return s;
            const next = { ...s.drafts };
            delete next[unitKey];
            return { drafts: next };
          }
          if (s.drafts[unitKey] === text) return s;
          return { drafts: { ...s.drafts, [unitKey]: text } };
        }),
      clearDraft: (unitKey) =>
        set((s) => {
          if (!(unitKey in s.drafts)) return s;
          const next = { ...s.drafts };
          delete next[unitKey];
          return { drafts: next };
        }),
    }),
    {
      name: STEER_DRAFT_STORE_NAME,
      version: STEER_DRAFT_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Only `drafts` is persisted — actions are recreated on load.
      partialize: (state) => ({ drafts: state.drafts }),
      migrate: (persisted): PersistedShape => {
        const p = persisted as Partial<PersistedShape> | undefined;
        return { drafts: p?.drafts ?? {} };
      },
    },
  ),
);

/** Read a draft without subscribing — used where a hook would be overkill
 *  (e.g. deciding whether to show a "resume draft" affordance on select). */
export function getSteerDraft(unitKey: string): string {
  return useSteerDraftStore.getState().drafts[unitKey] ?? "";
}
