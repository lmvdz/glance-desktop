import {
  Alert02Icon,
  DashboardCircleIcon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import {
  type FleetStatus,
  type FleetUnit,
  attentionReason,
  attentionUnits,
  sortUnits,
} from "./lib/fleetRoster";
import { getWorktreeOpener, isLoopbackDaemon } from "./lib/worktreeOpener";
import { useFleetConnection } from "./store/fleetConnectionStore";
import {
  type RosterConnection,
  useFleetRoster,
} from "./store/fleetRosterStore";

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
}: {
  u: FleetUnit;
  reason?: string;
  canOpen: boolean;
}) {
  const cost = fmtCost(u.receipt?.costUsd);
  const openable = canOpen && !!u.worktree;
  const openWorktree = () => {
    if (u.worktree)
      getWorktreeOpener()?.open({ name: u.name, worktree: u.worktree });
  };
  return (
    <div className="group flex items-center gap-2.5 rounded-md border border-gray-200/70 bg-white/50 px-2.5 py-1.5 dark:border-gray-800 dark:bg-gray-900/40">
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
      {openable && (
        <button
          type="button"
          onClick={openWorktree}
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

  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  // A worktree path is only openable when the daemon is on this machine (a remote daemon's
  // worktree lives on another host). Off for a non-loopback daemon — the row hides the button.
  const canOpen = isLoopbackDaemon(baseUrl);
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
        {units.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-gray-500">
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
                    key={u.id}
                    u={u}
                    reason={attentionReason(u)}
                    canOpen={canOpen}
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
                <UnitRow key={u.id} u={u} canOpen={canOpen} />
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
