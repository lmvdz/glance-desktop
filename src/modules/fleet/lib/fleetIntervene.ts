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

/** Why a unit is where it is — the same wording the roster attention lane uses, expanded for detail. */
export function whyStopped(u: FleetUnit): WhyStopped {
  switch (u.status) {
    case "input":
      return {
        label: "Waiting for you",
        detail: u.pending?.[0]?.title ?? "the unit asked for input",
        needsHuman: true,
      };
    case "error":
      return {
        label: "Errored",
        detail: u.error ?? "the unit hit a fatal error",
        needsHuman: true,
      };
    case "working":
      return { label: "Working", detail: "", needsHuman: false };
    case "idle":
      return {
        label: "Idle",
        detail: "turn finished — steer it with a new instruction",
        needsHuman: false,
      };
    case "starting":
      return {
        label: "Starting",
        detail: "process spawned, awaiting ready",
        needsHuman: false,
      };
    case "stopped":
      return {
        label: "Stopped",
        detail: "intentionally terminated",
        needsHuman: false,
      };
    default:
      return { label: u.status, detail: "", needsHuman: false };
  }
}
