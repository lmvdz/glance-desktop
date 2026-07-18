import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Which of the two stacked shells is visible (hub-shell concern H0).
 *
 * DIRECTION.md: glance's DEFAULT shell is t3code's two-pane thread client (the
 * "hub"); terax's IDE (editor/terminal/explorer) is the SUBSTRATE, opened on
 * demand as the "workspace" mode. App renders BOTH shells stacked and toggles
 * which one is visible off this single mode — nothing unmounts, so terminal
 * PTYs, editor buffers, and all `useTabs` state survive every mode flip.
 *
 * `mode` is nullable on purpose: `null` means "no explicit choice has been
 * persisted yet" (genuine first launch), which lets the boot planner
 * (`planShellBoot`) distinguish a returning user's restored shell from the
 * first-launch default. A persisted choice rehydrates synchronously, so App
 * resolves `null` at render time (hub by default, workspace when launched on a
 * file/folder) and the correct shell paints on the very first frame.
 */
export type ShellMode = "hub" | "workspace";

type ShellModeState = {
  /** null = never chosen (first launch); otherwise the user's/boot's last pick. */
  mode: ShellMode | null;
  /** Set the visible shell (persisted). */
  setMode: (mode: ShellMode) => void;
  /** Return to the thread hub. */
  showHub: () => void;
  /** Open the terax IDE / workspace shell. */
  showWorkspace: () => void;
};

export const SHELL_MODE_STORE_NAME = "glance-shell-mode";
/** Bump + branch `migrate` the day the persisted shape changes. */
export const SHELL_MODE_STORE_VERSION = 1;

export const useShellMode = create<ShellModeState>()(
  persist(
    (set) => ({
      mode: null,
      setMode: (mode) => set((s) => (s.mode === mode ? s : { mode })),
      showHub: () => set((s) => (s.mode === "hub" ? s : { mode: "hub" })),
      showWorkspace: () =>
        set((s) => (s.mode === "workspace" ? s : { mode: "workspace" })),
    }),
    {
      name: SHELL_MODE_STORE_NAME,
      version: SHELL_MODE_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ mode: state.mode }),
      migrate: (persisted): { mode: ShellMode | null } => {
        const p = persisted as { mode?: ShellMode | null } | undefined;
        return { mode: p?.mode ?? null };
      },
    },
  ),
);
