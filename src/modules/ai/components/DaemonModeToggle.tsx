import { cn } from "@/lib/utils";
import { useFleetConnection } from "@/modules/fleet/store/fleetConnectionStore";
import { type ChatMode, useChatStore } from "../store/chatStore";

// Local (BYOK) vs Daemon chat-mode toggle for the active session (fleet-ide-escalation E01). Daemon
// mode runs the chat as a glance daemon console unit. Defaults to Local so nothing regresses; the
// routing transport reads the mode fresh per turn, so flipping this takes effect on the next send.
export function DaemonModeToggle() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const mode = useChatStore((s) =>
    activeSessionId ? (s.sessionMode[activeSessionId] ?? "local") : "local",
  );
  const setSessionMode = useChatStore((s) => s.setSessionMode);
  const connStatus = useFleetConnection((s) => s.status);

  if (!activeSessionId) return null;

  const set = (m: ChatMode) => setSessionMode(activeSessionId, m);
  const daemonReady = connStatus === "connected";

  return (
    <div
      className="flex h-6 items-center rounded-md border border-border/60 bg-card p-0.5 text-[10.5px]"
      title={
        daemonReady
          ? "Chat transport: Local (your BYOK key) or Daemon (a glance fleet unit)"
          : "Daemon chat needs a connected glance daemon (Settings → Fleet)"
      }
    >
      <button
        type="button"
        onClick={() => set("local")}
        className={cn(
          "rounded-[5px] px-1.5 py-0.5 transition-colors",
          mode === "local"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Local
      </button>
      <button
        type="button"
        onClick={() => set("daemon")}
        className={cn(
          "rounded-[5px] px-1.5 py-0.5 transition-colors",
          mode === "daemon"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
          !daemonReady && mode !== "daemon" && "opacity-70",
        )}
      >
        Daemon
        {!daemonReady ? (
          <span
            className="ml-1 inline-block size-1.5 rounded-full bg-amber-500 align-middle"
            aria-hidden
          />
        ) : null}
      </button>
    </div>
  );
}
