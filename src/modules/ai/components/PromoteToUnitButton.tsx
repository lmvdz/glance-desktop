import { RocketIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { getWorktreeOpener } from "@/modules/fleet/lib/worktreeOpener";
import { useFleetConnection } from "@/modules/fleet/store/fleetConnectionStore";
import { getDaemonUnitId, useChatStore } from "../store/chatStore";

// "Promote to unit" (fleet-ide-escalation E02). Shown only for a daemon-mode chat that has already
// created a console unit: promotes that unit IN PLACE into a working, landable unit (the daemon clears
// the console restriction, keeps the worktree + transcript, and steers the task into the same session),
// then opens its worktree as a Space so the human can supervise the work.
const PROMOTE_TASK =
  "Go ahead and implement what we've discussed: make the changes in this worktree and commit them.";

type Phase = "idle" | "promoting" | "error";

export function PromoteToUnitButton() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const mode = useChatStore((s) =>
    activeSessionId ? (s.sessionMode[activeSessionId] ?? "local") : "local",
  );
  const client = useFleetConnection((s) => s.client);
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);

  const unitId = activeSessionId ? getDaemonUnitId(activeSessionId) : null;
  // Only meaningful once the daemon chat has spun up a unit to promote.
  if (mode !== "daemon" || !unitId) return null;

  const promote = async () => {
    if (phase === "promoting") return;
    setPhase("promoting");
    setErr(null);
    try {
      const res = await (await client()).promote(unitId, { task: PROMOTE_TASK });
      if (!res.ok) {
        setErr(res.reason ?? "promote failed");
        setPhase("error");
        return;
      }
      const agent = res.agent;
      if (agent?.worktree) {
        getWorktreeOpener()?.open({
          name: agent.name || "unit",
          worktree: agent.worktree,
        });
      }
      setPhase("idle");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "promote failed");
      setPhase("error");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void promote()}
      disabled={phase === "promoting"}
      title={
        err ??
        "Promote this chat into a working, landable unit — keeps the conversation, opens its worktree"
      }
      className={cn(
        "flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10.5px] transition-colors",
        phase === "error"
          ? "border-red-400/60 text-red-500"
          : "border-border/60 bg-card text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={RocketIcon} size={11} strokeWidth={1.75} />
      {phase === "promoting" ? "Promoting…" : "Promote to unit"}
    </button>
  );
}
