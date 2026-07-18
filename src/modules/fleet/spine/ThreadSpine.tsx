// The always-visible thread spine (t3-face concern 05 — the R2 centerpiece; see
// plans/t3-face/05-thread-spine.md and DESIGN.md's "Topology" decision row). Units + adoptable
// sessions as rows, grouped by project then daemon/host, with collapsible group headers and a
// roll-up attention dot. Renders REAL units from FleetClient. Concern 07 wired the attention pills,
// roll-ups, and header banner to the daemon's server-computed tier (`FleetUnit.ladderPriority`,
// concern 06) — the render tree is unchanged from concern 05; only the DATA SOURCE moved off the
// deleted client ranking.

import { Alert02Icon, InboxIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { FleetEmpty } from "../EmptyState";
import { ladderReason, needsHuman } from "../lib/fleetLadder";
import {
  canOpenUnitWorktree,
  getWorktreeOpener,
  isLoopbackDaemon,
} from "../lib/worktreeOpener";
import { useFleetConnection } from "../store/fleetConnectionStore";
import {
  type RosterConnection,
  useFleetRoster,
} from "../store/fleetRosterStore";
import { useFleetSelection } from "../store/fleetSelectionStore";
import { buildSpineGroups, shouldShowHostBadges } from "./lib/spineGrouping";
import { prewarmTopUnits } from "./lib/transcriptPrewarm";
import { useAdoptableSessions } from "./lib/useAdoptableSessions";
import { GroupHeader } from "./GroupHeader";
import { SpineHeader, SpineSkeleton } from "./SpineChrome";
import { AdoptSpineRow, UnitSpineRow } from "./SpineRow";

const CONN_LABEL: Record<RosterConnection, { text: string; cls: string }> = {
  connecting: { text: "connecting…", cls: "text-muted-foreground/70" },
  live: { text: "live", cls: "text-success" },
  reconnecting: { text: "reconnecting…", cls: "text-warning" },
  unauthorized: { text: "unauthorized", cls: "text-warning" },
};

export function ThreadSpine() {
  const { units, connection, start, stop } = useFleetRoster();
  const refresh = useFleetRoster((s) => s.refresh);
  const baseUrl = useFleetConnection((s) => s.baseUrl);
  const connections = useFleetConnection((s) => s.connections);
  const activeId = useFleetConnection((s) => s.activeId);
  const client = useFleetConnection((s) => s.client);
  const selectedId = useFleetSelection((s) => s.selectedId);
  const select = useFleetSelection((s) => s.select);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creatingThread, setCreatingThread] = useState(false);
  const [threadErr, setThreadErr] = useState<string | null>(null);

  // "New thread" (t3-face C13-F4): start a daemon console chat on the ACTIVE daemon, reusing
  // FleetClient.createConsole (repo omitted → the daemon's own working repo), then select it and
  // poll now so the row appears immediately instead of up to a ~2s cycle later.
  const newThread = async () => {
    if (creatingThread || !activeId) return;
    setCreatingThread(true);
    setThreadErr(null);
    try {
      const c = await client(activeId);
      const id = await c.createConsole();
      if (!id) {
        setThreadErr("Couldn't start a new thread on this daemon.");
        return;
      }
      // Poll BEFORE selecting: the new thread must be in the roster first, or FleetLayout's
      // "selected unit vanished" cleanup would immediately deselect a key it can't yet find.
      await refresh();
      select(`${activeId}:${id}`);
    } catch (e) {
      setThreadErr(e instanceof Error ? e.message : "Couldn't start a new thread.");
    } finally {
      setCreatingThread(false);
    }
  };

  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  // AdoptableSessions polls the ACTIVE daemon's presence list directly (not the merged roster),
  // so its own worktree-open gate stays keyed off the active connection — unchanged from the old
  // widget (useAdoptableSessions.ts).
  const canOpenActive = isLoopbackDaemon(baseUrl);
  const {
    sessions: adoptable,
    busy: adoptBusy,
    err: adoptErr,
    adopt,
  } = useAdoptableSessions(canOpenActive);

  const activeConn = connections.find((c) => c.id === activeId);
  const groups = useMemo(
    () =>
      buildSpineGroups(
        units,
        adoptable,
        activeConn ? { id: activeConn.id, label: activeConn.label } : null,
      ),
    [units, adoptable, activeConn],
  );
  const showHost = shouldShowHostBadges(groups);

  // Prewarm the top-N units' transcripts (SPINE_PREWARM_LIMIT = 10, t3's
  // SIDEBAR_THREAD_PREWARM_LIMIT) on mount and every roster poll — `units` is a fresh array
  // reference each ~2s poll cycle (fleetRosterStore's `sortUnits(mergeRosters(...))`), so this
  // effect naturally re-runs on that cadence without a second timer. The selected unit is skipped
  // (its own transcript-store poll already keeps it warm).
  useEffect(() => {
    if (units.length === 0) return;
    void prewarmTopUnits(units, { skipKey: selectedId, client });
  }, [units, selectedId, client]);

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const conn = CONN_LABEL[connection];
  const attention = units.filter(needsHuman);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <SpineHeader
        count={units.length}
        onNewThread={activeId ? () => void newThread() : undefined}
        right={<span className={`text-[11px] ${conn.cls}`}>{conn.text}</span>}
      />

      {threadErr && (
        <div className="shrink-0 border-b border-destructive/25 bg-destructive/5 px-3 py-1 text-[11px] text-destructive">
          {threadErr}
        </div>
      )}

      {attention.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-warning/25 bg-warning/5 px-3 py-1 text-[11px] font-medium text-warning-foreground">
          <HugeiconsIcon icon={Alert02Icon} size={12} />
          {attention.length} unit{attention.length === 1 ? "" : "s"} need
          {attention.length === 1 ? "s" : ""} you
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {units.length === 0 && adoptable.length === 0 ? (
          connection === "connecting" ? (
            <SpineSkeleton />
          ) : (
            <FleetEmpty
              compact
              icon={InboxIcon}
              title="No units running"
              description="When you start a unit or the fleet picks up work, it lands here."
            />
          )
        ) : (
          <div className="flex flex-col gap-0.5">
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.projectKey);
              const rowCount = g.daemonGroups.reduce(
                (n, d) => n + d.rows.length,
                0,
              );
              const multiDaemonProject = showHost && g.daemonGroups.length > 1;
              return (
                <div key={g.projectKey} className="flex flex-col">
                  <GroupHeader
                    label={g.projectLabel}
                    count={rowCount}
                    collapsed={isCollapsed}
                    rollupPriority={g.rollupPriority}
                    onToggle={() => toggleGroup(g.projectKey)}
                  />
                  {!isCollapsed && (
                    <div className="flex flex-col gap-0.5 pl-3">
                      {g.daemonGroups.map((d) => (
                        <div key={d.daemonId} className="flex flex-col gap-0.5">
                          {multiDaemonProject && (
                            <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-info-foreground/80">
                              {d.daemonLabel}
                            </div>
                          )}
                          {d.rows.map((row) =>
                            row.kind === "unit" ? (
                              <UnitSpineRow
                                key={row.key}
                                unit={row.unit}
                                reason={ladderReason(row.unit) || undefined}
                                selected={selectedId === row.key}
                                canOpen={canOpenUnitWorktree(
                                  connections,
                                  row.unit.daemonId,
                                )}
                                onSelect={() => select(row.key)}
                                onOpenWorktree={() =>
                                  row.unit.worktree &&
                                  getWorktreeOpener()?.open({
                                    name: row.unit.name,
                                    worktree: row.unit.worktree,
                                  })
                                }
                              />
                            ) : (
                              <AdoptSpineRow
                                key={row.key}
                                session={row.session}
                                busy={adoptBusy === row.session.key}
                                onAdopt={() => void adopt(row.session)}
                              />
                            ),
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {adoptErr && (
              <div className="px-2 py-1 text-[11px] text-destructive">
                {adoptErr}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
