// Why-a-row-needs-you + honest-duration + console-thread derivations for the thread spine (t3-face
// concern 13, findings 3 + 4). Pure and unit-tested, split out of the row component so the phrasing
// is verifiable without mounting React. Everything here reads fields ALREADY on the roster wire
// (pending / error / validation / prState / transitions / kind / promoted) — no new daemon field.
//
// The user's reaction that drove this: he opened the cockpit, saw "5 units need me", and said "I
// have no idea why they need me, I just see working for like 50 hrs and 'escalate'." So: (a) every
// needs-you row answers WHY in a line (`rowReason`), (b) durations are the time in the CURRENT state,
// never spawn age (`rowDuration`/`stateSince`), and (c) raw internal tokens never leak (`humanizeReason`).

import type { FleetUnit } from "../../lib/fleetRoster";
import { ladderReason } from "../../lib/fleetLadder";
import { formatDuration } from "../../timeline/deriveRows";

// ---------------------------------------------------------------------------------------
// Finding #4 — console chat threads (E01) rendered as conversations, distinct from work units.
// ---------------------------------------------------------------------------------------

/** True when this unit is a daemon "console" chat thread (fleet-ide-escalation E01), not a work
 *  unit. The daemon marks a console unit by an `omp-operator` kind + the fixed name `"chat"` + the
 *  console system-prompt; the prompt is NOT on the wire, so this mirrors the server's OWN non-prompt
 *  identity check — `promote()`'s gate rejects anything where `kind !== "omp-operator" || name !==
 *  "chat"` (squad-manager.ts). A PROMOTED chat is a real work unit now (`promoted`), so it drops out
 *  of this set and renders with full unit chrome. */
export function isConsoleThread(
  u: Pick<FleetUnit, "kind" | "name" | "promoted">,
): boolean {
  return u.kind === "omp-operator" && u.name === "chat" && u.promoted !== true;
}

/** Display title for a console thread row. The daemon names every console unit `"chat"` (meaningless
 *  in a list), and the first-prompt snippet isn't on the roster wire, so a thread reads as t3's
 *  "New thread" in the spine — its real identity is the conversation itself, in the detail pane. */
export function threadTitle(): string {
  return "New thread";
}

// ---------------------------------------------------------------------------------------
// Finding #3 (de-jargon) — internal tokens that can ride `activity`/a pending title into the spine.
// ---------------------------------------------------------------------------------------

/** Raw workflow node ids / internal states (verify-workflow.ts's graph nodes are the main offender —
 *  the user literally saw a bare "escalate") mapped to operator-facing words. Unit NAMES never pass
 *  through here — they're user-chosen and shown verbatim; only DERIVED reason/activity text does. */
const TOKEN_LABELS: Record<string, string> = {
  escalate: "Escalating to you",
  fixup: "Fixing up the change",
  verify: "Running verification",
  plan: "Planning",
  implement: "Implementing",
  review: "Reviewing",
  land: "Landing",
};

/** Humanize one derived reason/activity string: take the first line, strip an internal `GATE:` /
 *  `gate_` prefix, and map a bare known token to its operator phrase. A genuine question/error line
 *  passes through unchanged (only its first line, trimmed). */
export function humanizeReason(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const deGated = firstLine.replace(/^gate[\s_:-]+/i, "").trim();
  return TOKEN_LABELS[deGated.toLowerCase()] ?? deGated;
}

/** The one-line WHY under a row's title, or null. Only the tiers that actually want a human read a
 *  reason: the attention set (error / pending-approval / awaiting-input) plus `plan-ready` (staged,
 *  wants your OK). Working / idle / done rows get no reason line — their state is self-evident.
 *  Text is derived from fields already on the wire via `ladderReason` (pending title, error line,
 *  held-validator verdict, closed-PR), then humanized. */
export function rowReason(u: FleetUnit): string | null {
  switch (u.ladderPriority) {
    case "error":
    case "pending-approval":
    case "awaiting-input": {
      const raw = ladderReason(u);
      return raw ? humanizeReason(raw) : null;
    }
    case "plan-ready":
      return "Ready to land";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------
// Finding #3 (honest durations) — time in the CURRENT state, never spawn age.
// ---------------------------------------------------------------------------------------

/** Epoch-ms the unit ENTERED its current status: the `at` of the most recent recorded transition
 *  whose `to` is the current status. This is the only honest anchor for "time in current state" —
 *  the DTO's `startedAt` is stamped ONCE at spawn and never per turn, so a unit alive 50h but
 *  working 3m would read "Working for 50h" off it (the exact lie the user hit). Returns undefined
 *  when the wire carries no matching transition (a pre-transitions daemon, or a status reached with
 *  no recorded transition) — callers then show NO duration rather than fabricate an age. */
export function stateSince(u: FleetUnit): number | undefined {
  const ts = u.transitions;
  if (!ts || ts.length === 0) return undefined;
  for (let i = ts.length - 1; i >= 0; i--) {
    const t = ts[i];
    if (t && t.to === u.status) return t.at;
  }
  return undefined;
}

/** The honest duration phrase for a row, or null. Needs-you tiers read "Waiting on you for 12m"
 *  (since the wait began); error reads "Blocked for 12m"; the working tier reads "Working for 3m" —
 *  ALL measured from `stateSince`, never spawn age. `now` is injected for deterministic tests. A tier
 *  with no meaningful clock (idle / done / plan-ready) returns null. */
export function rowDuration(u: FleetUnit, now: number): string | null {
  const since = stateSince(u);
  if (since === undefined) return null;
  const dur = formatDuration(Math.max(0, now - since));
  switch (u.ladderPriority) {
    case "pending-approval":
    case "awaiting-input":
      return `Waiting on you for ${dur}`;
    case "error":
      return `Blocked for ${dur}`;
    case "working":
      return `Working for ${dur}`;
    default:
      return null;
  }
}
