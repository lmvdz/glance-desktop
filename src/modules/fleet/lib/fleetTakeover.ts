// Take over / hand back (fleet-ide-intervention I05) — the explicit peer handoff, composed in the
// cockpit from existing primitives (interrupt + set-mode + presence-write), no daemon change. Pure
// helpers here; the orchestration + side-effects live in the store. A daemon-atomic takeover
// primitive is a deferred hardening pass (see the concern doc).

/** A stable-per-window cockpit session id, so presence claims and lease holds attribute to THIS
 *  cockpit. Reserved namespaces (omp:/squad:) are the daemon's; ours is glance-cockpit:. */
export function cockpitAgentLabel(sessionId: string): string {
  return `glance-cockpit:${sessionId}`;
}

/** The hand-back resume prompt: tell the agent a human edited the tree so its next turn re-reads it
 *  deliberately. Names the changed files when known (from the diff/lease delta), else stays generic. */
export function resumePrompt(changedFiles: string[]): string {
  if (changedFiles.length === 0) {
    return "Resuming — I took over and may have edited the worktree. Re-read the current files before continuing.";
  }
  const list = changedFiles.slice(0, 8).join(", ");
  const more =
    changedFiles.length > 8 ? `, and ${changedFiles.length - 8} more` : "";
  return `Resuming — I edited ${list}${more}. Re-read those files before continuing.`;
}

export type TakeoverPhase = "idle" | "taking-over" | "active" | "handing-back";

export interface TakeoverState {
  phase: TakeoverPhase;
  /** The autonomy mode the unit had before takeover — restored on hand-back. */
  priorMode: string | null;
  /** The presence claim id to release on hand-back. */
  presenceId: string | null;
  error: string | null;
}

export const IDLE_TAKEOVER: TakeoverState = {
  phase: "idle",
  priorMode: null,
  presenceId: null,
  error: null,
};

/** Can we start a takeover? Only from idle (never double-take-over). */
export function canTakeOver(s: TakeoverState): boolean {
  return s.phase === "idle";
}

/** Can we hand back? Only while active. */
export function canHandBack(s: TakeoverState): boolean {
  return s.phase === "active";
}
