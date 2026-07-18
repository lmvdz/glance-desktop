// Unit + adoptable-session rows for the thread spine (t3-face concern 05). t3 row idioms: dense
// `h-6 sm:h-7 px-2` single-line rows, `active:bg-accent/85` / selected `bg-primary/15`, hover-reveal
// trailing actions via a named group (`opacity-0 group-hover/row:opacity-100` +
// `pointer-events-none`/`pointer-events-auto` swap — the same crossfade choreography as
// GroupHeader's chevron, scoped to the row instead of the header), truncating title, a trailing
// meta slot (cost / worktree-open button). Per-row daemon badges were dropped in favor of the
// daemon sub-header line in ThreadSpine (grouping already disambiguates by daemon — see
// spineGrouping.ts — so repeating it on every row read as clutter); full repo/branch identity
// moves into the row's `title` tooltip since the project group header already carries it.

import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import type { AdoptableSession } from "../lib/fleetAdopt";
import type { FleetUnit } from "../lib/fleetRoster";
import { AttentionPill } from "./AttentionPill";
import { fmtCost, repoLabel } from "./lib/spineFormat";

export function UnitSpineRow({
  unit,
  reason,
  selected,
  canOpen,
  onSelect,
  onOpenWorktree,
}: {
  unit: FleetUnit;
  /** fleetRoster's `attentionReason()` when this unit is in the attention queue; undefined
   *  otherwise, so the pill tooltip falls back to the bare status label. */
  reason?: string;
  selected: boolean;
  canOpen: boolean;
  onSelect: () => void;
  onOpenWorktree: () => void;
}) {
  const cost = fmtCost(unit.receipt?.costUsd);
  const openable = canOpen && !!unit.worktree;
  return (
    <div
      className={cn(
        "group/row flex h-6 items-center gap-1 rounded-md pr-1 sm:h-7",
        selected && "bg-primary/15",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        title={`${unit.name} — ${repoLabel(unit)}`}
        aria-current={selected ? "true" : undefined}
        className="flex h-6 min-w-0 flex-1 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-accent/40 active:bg-accent/85 focus-visible:ring-1 focus-visible:ring-ring sm:h-7"
      >
        <AttentionPill status={unit.status} reason={reason} compact />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
          {unit.name}
        </span>
        {unit.harness && (
          <span className="shrink-0 truncate text-[10px] text-muted-foreground/60">
            {unit.harness}
          </span>
        )}
        {cost && (
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            {cost}
          </span>
        )}
      </button>
      {openable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenWorktree();
          }}
          title={`Open ${unit.worktree} as a Space`}
          className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded pointer-events-none text-muted-foreground/60 opacity-0 transition-all hover:bg-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover/row:pointer-events-auto group-hover/row:opacity-100"
        >
          <HugeiconsIcon icon={FolderOpenIcon} size={13} />
        </button>
      )}
    </div>
  );
}

export function AdoptSpineRow({
  session,
  busy,
  onAdopt,
}: {
  session: AdoptableSession;
  busy: boolean;
  onAdopt: () => void;
}) {
  return (
    <div className="group/row flex h-6 items-center gap-2 rounded-md px-2 sm:h-7">
      <span className="size-1.5 shrink-0 rounded-full bg-info" aria-hidden />
      <span className="shrink-0 truncate text-[12px] font-medium text-foreground">
        {session.harness}
      </span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/70">
        {session.repoName}
        {session.host ? ` · ${session.host}` : ""}
      </span>
      <button
        type="button"
        onClick={onAdopt}
        disabled={busy}
        title="Capture this session's work into a new fleet unit"
        className={cn(
          "shrink-0 cursor-pointer rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-foreground/75 transition-opacity hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring",
          // Hover-reveal like every other row action — EXCEPT while busy: an in-flight adopt must
          // stay visible even if the pointer wanders off the row, or "Adopting…" vanishes mid-flight.
          busy
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {busy ? "Adopting…" : "Adopt"}
      </button>
    </div>
  );
}
