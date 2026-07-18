// Pure helpers for the intervene pane (fleet-ide-cockpit C07): why a unit stopped, and how
// to colorize a unified diff. Kept separate from the component so both are unit-testable.

import type { FleetUnit } from "./fleetRoster";

/** One changed file's unified diff — the daemon's FileDiff shape (GET /api/agents/:id/diff). */
export interface FleetFileDiff {
  file: string;
  status: string;
  diff: string;
}

/** Defensive: keep only well-formed file-diffs from an untrusted payload. */
export function normalizeDiff(payload: unknown): FleetFileDiff[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (d): d is FleetFileDiff =>
      !!d &&
      typeof d === "object" &&
      typeof (d as FleetFileDiff).file === "string" &&
      typeof (d as FleetFileDiff).diff === "string",
  );
}

export interface WhyStopped {
  /** Short label for the state. */
  label: string;
  /** One-line detail — the pending question, the error, or the block reason. Empty when running. */
  detail: string;
  /** True when this state actually wants a human (drives the steer composer's prominence). */
  needsHuman: boolean;
}

/** Why a unit is where it is — the same wording the roster attention lane uses, expanded for detail.
 *  Written from the operator's side of the screen (t3-face C11 copy pass): plain state names, no
 *  process/dev jargon, and a next-step in the detail line wherever there's one to offer. */
export function whyStopped(u: FleetUnit): WhyStopped {
  switch (u.status) {
    case "input":
      return {
        label: "Waiting for you",
        detail: u.pending?.[0]?.title ?? "It asked a question and is waiting on your answer.",
        needsHuman: true,
      };
    case "error":
      return {
        label: "Hit an error",
        detail: u.error ?? "It stopped on an error. Steer it or take over to recover.",
        needsHuman: true,
      };
    case "working":
      return { label: "Working", detail: "", needsHuman: false };
    case "idle":
      return {
        label: "Idle",
        detail: "It finished its turn. Send a new instruction to continue.",
        needsHuman: false,
      };
    case "starting":
      return {
        label: "Starting up",
        detail: "It's spinning up and will pick up work shortly.",
        needsHuman: false,
      };
    case "stopped":
      return {
        label: "Stopped",
        detail: "You stopped this unit.",
        needsHuman: false,
      };
    default:
      return { label: u.status, detail: "", needsHuman: false };
  }
}
