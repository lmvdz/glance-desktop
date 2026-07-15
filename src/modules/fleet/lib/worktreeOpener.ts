// The fleet→ground gesture (fleet-ide-cockpit C06): opening a unit's git worktree as a Space.
// The create-or-focus logic needs the App's useTabs instance (newTab / setActiveSpaceForNewTabs),
// which isn't a global store — so App registers a handler here on mount and RosterView calls it,
// mirroring the lsp module's setLspNavigator singleton. Absent handler = a no-op (nothing mounted).

export interface WorktreeTarget {
  /** Display name for the new Space. */
  name: string;
  /** Absolute path of the unit's git worktree — becomes the Space root + the terminal cwd. */
  worktree: string;
}

export interface WorktreeOpener {
  open: (target: WorktreeTarget) => void;
}

let current: WorktreeOpener | null = null;

export function setWorktreeOpener(opener: WorktreeOpener | null): void {
  current = opener;
}

export function getWorktreeOpener(): WorktreeOpener | null {
  return current;
}

/**
 * Create-or-FOCUS decision, pure so it's testable without the App's tab system: if a Space is
 * already rooted at this worktree, focus it; otherwise create a new one. This is what makes
 * clicking a unit twice never spawn a duplicate Space.
 */
export function resolveOpenAction(
  spaces: ReadonlyArray<{ id: string; root: string | null }>,
  worktree: string,
): { kind: "focus"; id: string } | { kind: "create" } {
  const existing = spaces.find((s) => s.root === worktree);
  return existing ? { kind: "focus", id: existing.id } : { kind: "create" };
}

/**
 * A worktree path is only openable when the daemon runs on THIS machine — a remote daemon's
 * worktree lives on another host and this cockpit can't cd into it. Loopback base URL ⇒ local.
 */
export function isLoopbackDaemon(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}
