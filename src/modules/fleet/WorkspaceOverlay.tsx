import { File01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import { groupByHolder, liveLeases } from "./lib/fleetWorkspace";
import { useFleetWorkspace } from "./store/fleetWorkspaceStore";

// "Working here" — who holds which file in the unit's worktree (fleet-ide-intervention I04), so a
// human intervening in a shared tree sees what the agent (and their own cockpit) is touching before
// they edit. Reads GET /api/leases via the workspace store; nothing renders when nothing is held.

export function WorkspaceOverlay({ repo }: { repo: string }) {
  const leases = useFleetWorkspace((s) => s.leases);
  const start = useFleetWorkspace((s) => s.start);
  const stop = useFleetWorkspace((s) => s.stop);

  useEffect(() => {
    start(repo);
    return () => stop();
  }, [repo, start, stop]);

  // Filter to leases still live by the daemon's TTL, then group by holder (human first).
  const groups = groupByHolder(liveLeases(leases, Date.now()));
  if (groups.length === 0) return null;

  return (
    <div className="mb-3 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        Working here
      </div>
      <div className="flex flex-col gap-1.5">
        {groups.map((g) => (
          <div key={g.session} className="flex items-start gap-2">
            <HugeiconsIcon
              icon={UserIcon}
              size={13}
              className={
                g.human
                  ? "mt-0.5 shrink-0 text-success"
                  : "mt-0.5 shrink-0 text-muted-foreground/60"
              }
            />
            <div className="flex min-w-0 flex-col">
              <span
                className={`text-[11px] font-medium ${g.human ? "text-success-foreground" : "text-foreground/80"}`}
              >
                {g.human ? "you" : g.session}
              </span>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                {g.files.map((f) => (
                  <span
                    key={f}
                    className="flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground"
                  >
                    <HugeiconsIcon icon={File01Icon} size={10} />
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
