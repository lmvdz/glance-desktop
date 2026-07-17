import {
  ArrowDown01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  FolderOpenIcon,
  Logout03Icon,
  SentIcon,
  UserSharingIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { ConversationView } from "./ConversationView";
import {
  type DiffLineKind,
  type FleetFileDiff,
  diffLineKind,
  normalizeDiff,
  whyStopped,
} from "./lib/fleetIntervene";
import type { FleetUnit } from "./lib/fleetRoster";
import {
  IDLE_TAKEOVER,
  type TakeoverState,
  canHandBack,
  canTakeOver,
  cockpitAgentLabel,
  resumePrompt,
} from "./lib/fleetTakeover";
import { getWorktreeOpener } from "./lib/worktreeOpener";
import { WorkspaceOverlay } from "./WorkspaceOverlay";
import { useFleetConnection } from "./store/fleetConnectionStore";
import { useFleetTranscript } from "./store/fleetTranscriptStore";

const LINE_CLS: Record<DiffLineKind, string> = {
  add: "bg-success/10 text-success-foreground",
  del: "bg-destructive/10 text-destructive",
  hunk: "text-info-foreground",
  meta: "text-muted-foreground/70",
  context: "text-muted-foreground",
};

function FileDiffBlock({ fd }: { fd: FleetFileDiff }) {
  return (
    <div className="overflow-hidden rounded-md border border-border/60">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/60 px-2.5 py-1">
        <span className="truncate font-mono text-[11px] text-foreground/85">
          {fd.file}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {fd.status}
        </span>
      </div>
      <pre className="overflow-x-auto px-2.5 py-1.5 text-[11px] leading-relaxed">
        {fd.diff.split("\n").map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are static, index is stable
          <div key={i} className={LINE_CLS[diffLineKind(line)]}>
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function IntervenePane({
  unit,
  onBack,
  canOpen,
}: {
  unit: FleetUnit;
  onBack: () => void;
  canOpen: boolean;
}) {
  // M02: every action below MUST target the UNIT's own daemon, not the currently-active one — a
  // unit surfaced from a remote daemon in the merged roster is still driven by that daemon even
  // while a different one is active in the connection switcher.
  const client = useFleetConnection((s) => s.client);
  const [diff, setDiff] = useState<FleetFileDiff[] | null>(null);
  const [diffErr, setDiffErr] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [steerText, setSteerText] = useState("");
  const [steering, setSteering] = useState(false);
  const [steerErr, setSteerErr] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // A stable session id for THIS intervene pane, so the human's presence claim attributes here.
  const sessionId = useRef<string>(crypto.randomUUID()).current;
  const [takeover, setTakeover] = useState<TakeoverState>(IDLE_TAKEOVER);

  const entries = useFleetTranscript((s) => s.entries);
  const startTranscript = useFleetTranscript((s) => s.start);
  const stopTranscript = useFleetTranscript((s) => s.stop);
  const addOptimistic = useFleetTranscript((s) => s.addOptimistic);

  // The unit's live ACP conversation polls while this pane is open — against ITS daemon.
  useEffect(() => {
    startTranscript(unit.id, unit.daemonId);
    return () => stopTranscript();
  }, [unit.id, unit.daemonId, startTranscript, stopTranscript]);

  useEffect(() => {
    let alive = true;
    setDiff(null);
    setDiffErr(null);
    void (async () => {
      try {
        const raw = await (await client(unit.daemonId)).diff(unit.id);
        if (alive) setDiff(normalizeDiff(raw));
      } catch (e) {
        if (alive)
          setDiffErr(e instanceof Error ? e.message : "diff unavailable");
      }
    })();
    return () => {
      alive = false;
    };
  }, [unit.id, unit.daemonId, client]);

  const why = whyStopped(unit);

  // Send a turn INTO the same ACP session (POST /api/command {type:"prompt"}) — never a keystroke/PTY
  // path (the glance send_to_agent anti-pattern). Show the turn optimistically; the poll reconciles it.
  const steer = async () => {
    const message = steerText.trim();
    if (!message || steering) return;
    const clientTurnId = crypto.randomUUID();
    setSteering(true);
    setSteerErr(null);
    addOptimistic(message, clientTurnId);
    setSteerText("");
    try {
      const res = await (await client(unit.daemonId)).steer(unit.id, message);
      if (!res.ok) setSteerErr(res.detail ?? "steer failed");
    } catch (e) {
      setSteerErr(e instanceof Error ? e.message : "steer failed");
    } finally {
      setSteering(false);
    }
  };

  // Take over: quiesce the agent and mark the human as driving — interrupt the current turn, set
  // the unit to observe, and claim presence in the worktree. Composed from existing primitives (no
  // daemon takeover primitive; a half-applied takeover surfaces its error and stays recoverable).
  const takeOver = async () => {
    if (!canTakeOver(takeover) || !unit.worktree) return;
    const priorMode = unit.autonomyMode ?? "assist";
    setTakeover({
      phase: "taking-over",
      priorMode,
      presenceId: null,
      error: null,
    });
    try {
      const c = await client(unit.daemonId);
      await c.interrupt(unit.id);
      await c.setMode(unit.id, "observe", "human took over from the cockpit");
      const presenceId = await c.claimPresence(
        unit.worktree,
        cockpitAgentLabel(sessionId),
      );
      setTakeover({ phase: "active", priorMode, presenceId, error: null });
    } catch (e) {
      setTakeover({
        phase: "idle",
        priorMode: null,
        presenceId: null,
        error: e instanceof Error ? e.message : "take over failed",
      });
    }
  };

  // Hand back: restore the prior mode, release the human's presence, and resume the agent with a
  // prompt naming the files edited so its next turn re-reads the tree deliberately.
  const handBack = async () => {
    if (!canHandBack(takeover)) return;
    const { priorMode, presenceId } = takeover;
    setTakeover({ ...takeover, phase: "handing-back", error: null });
    try {
      const c = await client(unit.daemonId);
      await c.setMode(
        unit.id,
        priorMode ?? "assist",
        "human handed back from the cockpit",
      );
      if (presenceId && unit.worktree)
        await c.releasePresence(presenceId, unit.worktree);
      await c.steer(unit.id, resumePrompt((diff ?? []).map((d) => d.file)));
      setTakeover(IDLE_TAKEOVER);
    } catch (e) {
      setTakeover({
        ...takeover,
        phase: "active",
        error: e instanceof Error ? e.message : "hand back failed",
      });
    }
  };

  const driving =
    takeover.phase === "active" || takeover.phase === "handing-back";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          title="Back to roster"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} size={16} />
        </button>
        <span className="truncate text-sm font-semibold text-foreground">
          {unit.name}
        </span>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          {unit.status}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {unit.worktree &&
            (driving ? (
              <button
                type="button"
                onClick={() => void handBack()}
                disabled={takeover.phase === "handing-back"}
                title="Restore the unit's mode and resume it with your changes"
                className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-success/40 bg-success/10 px-2 text-[11px] font-medium text-success-foreground hover:bg-success/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <HugeiconsIcon icon={Logout03Icon} size={13} />
                {takeover.phase === "handing-back"
                  ? "Handing back…"
                  : "Hand back"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void takeOver()}
                disabled={takeover.phase === "taking-over"}
                title="Pause the agent and drive this worktree yourself"
                className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border/60 px-2 text-[11px] text-foreground/75 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <HugeiconsIcon icon={UserSharingIcon} size={13} />
                {takeover.phase === "taking-over"
                  ? "Taking over…"
                  : "Take over"}
              </button>
            ))}
          {canOpen && unit.worktree && (
            <button
              type="button"
              onClick={() =>
                unit.worktree &&
                getWorktreeOpener()?.open({
                  name: unit.name,
                  worktree: unit.worktree,
                })
              }
              title={`Open ${unit.worktree} as a Space`}
              className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border/60 px-2 text-[11px] text-foreground/75 hover:bg-accent"
            >
              <HugeiconsIcon icon={FolderOpenIcon} size={13} />
              Open worktree
            </button>
          )}
        </div>
      </header>

      {driving && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-success/30 bg-success/10 px-3 py-1.5 text-[11px] text-success-foreground">
          <HugeiconsIcon icon={UserSharingIcon} size={13} />
          You're driving — the agent is paused (observe). Edit in the worktree,
          then hand back to resume it.
        </div>
      )}
      {takeover.error && (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {takeover.error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* Why-stopped — the first thing you want when a unit needs you. */}
        <div
          className={`mb-3 rounded-md border px-3 py-2 ${why.needsHuman ? "border-warning/40 bg-warning/10" : "border-border/60 bg-muted/40"}`}
        >
          <div
            className={`text-[12px] font-medium ${why.needsHuman ? "text-warning-foreground" : "text-foreground/85"}`}
          >
            {why.label}
          </div>
          {why.detail && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {why.detail}
            </div>
          )}
        </div>

        {/* Who holds which file in this worktree (I04) — shared-workspace awareness. */}
        <WorkspaceOverlay repo={unit.repo} />

        {/* Changes — collapsible, so the conversation leads. */}
        <button
          type="button"
          onClick={() => setShowDiff((v) => !v)}
          className="mb-1.5 flex w-full cursor-pointer items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70 hover:text-foreground/75"
        >
          <HugeiconsIcon
            icon={showDiff ? ArrowDown01Icon : ArrowRight01Icon}
            size={12}
          />
          Changes{diff && diff.length > 0 ? ` (${diff.length})` : ""}
        </button>
        {showDiff && (
          <div className="mb-3 flex flex-col gap-2">
            {diffErr ? (
              <div className="text-[11px] text-destructive">{diffErr}</div>
            ) : diff === null ? (
              <div className="text-[11px] text-muted-foreground/70">
                Loading diff…
              </div>
            ) : diff.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/70">
                No uncommitted changes.
              </div>
            ) : (
              diff.map((fd) => <FileDiffBlock key={fd.file} fd={fd} />)
            )}
          </div>
        )}

        {/* The live ACP conversation — the spine of intervention. */}
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Conversation
        </div>
        <ConversationView entries={entries} />
      </div>

      {/* Steer composer. */}
      <div className="shrink-0 border-t border-border/60 p-2.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void steer();
              }
            }}
            placeholder="Message this unit… (⌘/Ctrl+Enter to send)"
            rows={2}
            className="min-h-9 flex-1 resize-none rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-ring"
          />
          <button
            type="button"
            onClick={() => void steer()}
            disabled={steering || !steerText.trim()}
            title="Send (⌘/Ctrl+Enter)"
            className="flex h-9 cursor-pointer items-center gap-1 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <HugeiconsIcon icon={SentIcon} size={14} />
            {steering ? "Sending…" : "Send"}
          </button>
        </div>
        {steerErr && (
          <div className="mt-1 text-[11px] text-destructive">{steerErr}</div>
        )}
      </div>
    </div>
  );
}
