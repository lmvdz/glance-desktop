// The always-visible thread spine + adjacent detail pane (t3-face concern 05 — see
// plans/t3-face/05-thread-spine.md). Replaces the old RosterView `if (selected) return
// <IntervenePane…>` modal drill-down: the list (ThreadSpine) never unmounts when the selection
// changes; only the right-hand detail side swaps between IntervenePane and the empty state.

import { useEffect } from "react";
import { IntervenePane } from "../IntervenePane";
import { canOpenUnitWorktree } from "../lib/worktreeOpener";
import { unitKey } from "../lib/fleetRoster";
import { useFleetConnection } from "../store/fleetConnectionStore";
import { useFleetRoster } from "../store/fleetRosterStore";
import { useFleetSelection } from "../store/fleetSelectionStore";
import { ThreadSpine } from "./ThreadSpine";

function EmptyDetail() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-8 text-center">
      <span className="text-[13px] font-medium text-foreground/85">
        Select a unit
      </span>
      <span className="max-w-xs text-[11px] text-muted-foreground/70">
        Pick a unit or ad-hoc session on the left to see why it stopped, its
        diff, and steer it.
      </span>
    </div>
  );
}

export function FleetLayout() {
  const units = useFleetRoster((s) => s.units);
  const connections = useFleetConnection((s) => s.connections);
  const selectedId = useFleetSelection((s) => s.selectedId);
  const select = useFleetSelection((s) => s.select);

  const selected = selectedId
    ? units.find((u) => unitKey(u) === selectedId)
    : undefined;

  // A selected unit that vanishes from the roster (landed/removed) drops back to the empty detail
  // state once the roster has actually loaded — ported unchanged from RosterView's own effect.
  useEffect(() => {
    if (selectedId && !selected && units.length > 0) select(null);
  }, [selectedId, selected, units.length, select]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="w-64 shrink-0 border-r border-border/60 sm:w-72">
        <ThreadSpine />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        {selected ? (
          <IntervenePane
            unit={selected}
            canOpen={canOpenUnitWorktree(connections, selected.daemonId)}
            onBack={() => select(null)}
          />
        ) : (
          <EmptyDetail />
        )}
      </div>
    </div>
  );
}
