import {
  Alert02Icon,
  DashboardCircleIcon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import { IntervenePane } from "./IntervenePane";
import {
  type FleetStatus,
  type FleetUnit,
  attentionReason,
  attentionUnits,
  sortUnits,
  unitKey,
} from "./lib/fleetRoster";
import { AdoptableSessions } from "./AdoptableSessions";
import {
  canOpenUnitWorktree,
  getWorktreeOpener,
  isLoopbackDaemon,
} from "./lib/worktreeOpener";
import { useFleetConnection } from "./store/fleetConnectionStore";
import {
  type RosterConnection,
  useFleetRoster,
} from "./store/fleetRosterStore";
import { useFleetSelection } from "./store/fleetSelectionStore";

const STATUS_DOT: Record<FleetStatus, string> = {
  input: "bg-red-500",
  error: "bg-red-500",
  working: "bg-emerald-500",
  idle: "bg-gray-400",
  starting: "bg-amber-400",
  stopped: "bg-gray-600",
};

const CONN_LABEL: Record<RosterConnection, { text: string; cls: string }> = {
  connecting: { text: "connecting…", cls: "text-gray-400" },
  live: { text: "live", cls: "text-emerald-500" },
  reconnecting: { text: "reconnecting…", cls: "text-amber-500" },
  unauthorized: { text: "unauthorized", cls: "text-amber-500" },
};

function fmtCost(n?: number): string | null {
  if (n == null) return null;
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

function repoLabel(u: FleetUnit): string {
  const repo =
    u.repoName ?? u.repo.split(/[\\/]/).filter(Boolean).pop() ?? u.repo;
  return u.branch ? `${repo} · ${u.branch}` : repo;
}

function UnitRow({
  u,
  reason,
  canOpen,
  showHost,
  onSelect,
}: {
  u: FleetUnit;
  reason?: string;
  canOpen: boolean;
  /** Show this unit's daemon/host badge — off when only one daemon is connected (nothing to
   *  disambiguate, avoids row clutter). */
  showHost: boolean;
  onSelect: (key: string) => void;
}) {
  const cost = fmtCost(u.receipt?.costUsd);
  const openable = canOpen && !!u.worktree;
  // The selectable area is a real <button> (opens the detail pane); the folder button sits
  // beside it as a sibling — no nested interactive elements, so both stay valid + accessible.
  return (
    <div className="group flex items-center gap-1 rounded-md border border-gray-200/70 bg-white/50 pr-1.5 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40 dark:hover:border-gray-700 dark:hover:bg-gray-900/70">
      <button
        type="button"
        onClick={() => onSelect(unitKey(u))}
        title={`Open ${u.name} — why it stopped, its diff, and steer it`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <span
          role="img"
          className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[u.status]}`}
          aria-label={u.status}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-gray-900 dark:text-gray-100">
              {u.name}
            </span>
            {showHost && (
              <span
                className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-1.5 text-[10px] text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                title={`Daemon: ${u.daemonLabel ?? u.daemonId}`}
              >
                {u.daemonLabel ?? u.daemonId}
              </span>
            )}
            {u.harness && (
              <span className="shrink-0 rounded-full border border-gray-200 px-1.5 text-[10px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                {u.harness}
              </span>
            )}
          </div>
          <span className="truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
            {repoLabel(u)}
          </span>
          {reason && (
            <span className="truncate text-[11px] text-amber-600 dark:text-amber-400">
              {reason}
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end text-[11px] text-gray-400 dark:text-gray-500">
          <span className="uppercase tracking-wide">{u.status}</span>
          {cost && <span>{cost}</span>}
        </div>
      </button>
      {openable && (
        <button
          type="button"
          onClick={() =>
            u.worktree &&
            getWorktreeOpener()?.open({ name: u.name, worktree: u.worktree })
          }
          title={`Open ${u.worktree} as a Space`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-gray-400 opacity-0 transition-all hover:bg-gray-100 hover:text-gray-700 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-500 group-hover:opacity-100 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <HugeiconsIcon icon={FolderOpenIcon} size={15} />
        </button>
      )}
    </div>
  );
}

export function RosterView() {
  const { units, connection, start, stop } = useFleetRoster();
  const baseUrl = useFleetConnection((s) => s.baseUrl);
  // Every configured daemon connection (M01) — needed to gate "open worktree" per UNIT (its own
  // daemon must be loopback) rather than by whichever daemon happens to be active.
  const connections = useFleetConnection((s) => s.connections);
  // Selection lives in a store (not local state) so a notification click (C08) can focus a unit.
  // `selectedId` holds a roster `unitKey` (daemonId:id), disambiguating same-id units across
  // daemons (M02).
  const selectedId = useFleetSelection((s) => s.selectedId);
  const select = useFleetSelection((s) => s.select);

  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  // AdoptableSessions polls the ACTIVE daemon's presence list directly (not the merged roster),
  // so its own worktree-open gate stays keyed off the active connection.
  const canOpenActive = isLoopbackDaemon(baseUrl);
  // Host badges earn their row space only once there's something to disambiguate.
  const showHost = connections.length > 1;

  // Selecting a unit swaps the list for its intervene detail. The live roster keeps polling in
  // the background; when the selected unit vanishes (landed/removed) and the roster has loaded,
  // drop back to the list.
  const selected = selectedId
    ? units.find((u) => unitKey(u) === selectedId)
    : undefined;
  useEffect(() => {
    if (selectedId && !selected && units.length > 0) select(null);
  }, [selectedId, selected, units.length, select]);
  if (selected) {
    return (
      <IntervenePane
        unit={selected}
        canOpen={canOpenUnitWorktree(connections, selected.daemonId)}
        onBack={() => select(null)}
      />
    );
  }
  const attention = attentionUnits(units);
  const all = sortUnits(units);
  const conn = CONN_LABEL[connection];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={DashboardCircleIcon}
            size={16}
            className="text-gray-500 dark:text-gray-400"
          />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            Fleet
          </span>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            {units.length} unit{units.length === 1 ? "" : "s"}
          </span>
        </div>
        <span className={`text-[11px] ${conn.cls}`}>{conn.text}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-4">
          <AdoptableSessions canOpen={canOpenActive} />
        </div>
        {units.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-gray-400 dark:text-gray-500">
            {connection === "connecting"
              ? "Loading roster…"
              : "No units — the fleet is idle."}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {attention.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  <HugeiconsIcon icon={Alert02Icon} size={13} />
                  Needs you ({attention.length})
                </div>
                {attention.map((u) => (
                  <UnitRow
                    key={unitKey(u)}
                    u={u}
                    reason={attentionReason(u)}
                    canOpen={canOpenUnitWorktree(connections, u.daemonId)}
                    showHost={showHost}
                    onSelect={select}
                  />
                ))}
              </section>
            )}
            <section className="flex flex-col gap-1.5">
              {attention.length > 0 && (
                <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  All units
                </div>
              )}
              {all.map((u) => (
                <UnitRow
                  key={unitKey(u)}
                  u={u}
                  canOpen={canOpenUnitWorktree(connections, u.daemonId)}
                  showHost={showHost}
                  onSelect={select}
                />
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
