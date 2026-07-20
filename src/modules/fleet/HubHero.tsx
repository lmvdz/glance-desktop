// The hub's empty-detail hero (r3 borrow 6 — plans/research-t3code round 3): t3code's brand-new
// draft-hero landing ("What should we build?", shipped there 2026-07-18), adapted to the fleet
// hub. Replaces the passive "Select a unit" card with the on-ramp gesture: type here, and the
// send starts a console thread on the active daemon and opens it — the ten-second on-ramp law
// applied to the desktop's first frame. Desktop skips t3's hero→docked view-transition morph
// (theirs is mobile-only; the thread opens with the message already in flight).
//
// Input sanctity (round-2 law 5): the hero's draft persists in the steer-draft store under a
// per-daemon `<daemonId>:new-thread` key, so a half-typed kickoff survives restarts and never
// collides with a real unit's draft (unit ids are daemon-scoped; "new-thread" is not a unit id).

import { useRef, useState } from "react";
import { ComposerShell } from "@/components/composer/ComposerShell";
import { startConsoleThread } from "./lib/startThread";
import { useFleetConnection } from "./store/fleetConnectionStore";
import { useFleetRoster } from "./store/fleetRosterStore";
import { useFleetSelection } from "./store/fleetSelectionStore";
import { useSteerDraftStore } from "./store/fleetSteerDraftStore";

export function HubHero() {
  const activeId = useFleetConnection((s) => s.activeId);
  const client = useFleetConnection((s) => s.client);
  const connections = useFleetConnection((s) => s.connections);
  const refresh = useFleetRoster((s) => s.refresh);
  const select = useFleetSelection((s) => s.select);

  const draftKey = `${activeId ?? "none"}:new-thread`;
  const text = useSteerDraftStore((s) => s.drafts[draftKey] ?? "");
  const setDraft = useSteerDraftStore((s) => s.setDraft);
  const clearDraft = useSteerDraftStore((s) => s.clearDraft);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const daemonLabel = connections.find((c) => c.id === activeId)?.label;

  const send = async () => {
    const message = text.trim();
    if (!message || busy || !activeId) return;
    setBusy(true);
    setErr(null);
    const res = await startConsoleThread({
      client,
      activeId,
      refresh,
      select,
      firstMessage: message,
    });
    setBusy(false);
    if (res.ok) {
      clearDraft(draftKey);
    } else {
      setErr(res.reason);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="flex w-full max-w-xl flex-col gap-5">
        <div className="flex flex-col gap-1.5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            What should we build?
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {daemonLabel ? (
              <>
                Start a thread on <span className="text-foreground/80">{daemonLabel}</span>, or
                pick one on the left.
              </>
            ) : (
              "Start a thread, or pick one on the left."
            )}
          </p>
        </div>
        <ComposerShell
          running={false}
          canSend={!busy && text.trim().length > 0}
          onSend={() => void send()}
          onStop={() => {}}
          sendTitle="Start this thread (⌘/Ctrl+Enter)"
        >
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setDraft(draftKey, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Describe the work… (⌘/Ctrl+Enter to start)"
            rows={3}
            disabled={busy}
            className="min-h-14 max-h-48 w-full resize-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </ComposerShell>
        {err && <div className="text-center text-[11px] text-destructive">{err}</div>}
        {busy && (
          <div className="text-center text-[11px] text-muted-foreground">Starting the thread…</div>
        )}
      </div>
    </div>
  );
}
