import { useEffect, useState } from "react";
import {
  type AdoptableSession,
  adoptableSessions,
  normalizePresence,
} from "./lib/fleetAdopt";
import { getWorktreeOpener } from "./lib/worktreeOpener";
import { useFleetConnection } from "./store/fleetConnectionStore";

// "Ad-hoc sessions" — raw CLI sessions (a developer's `claude` in a terminal) that B03 harness-hooks
// registered as daemon presence. "Adopt" pulls the session's uncommitted work into a fresh fleet unit
// (fleet-ide-escalation E03) and, on a loopback daemon, opens its worktree as a Space. Polls presence
// (CSP forbids ws://); renders nothing when there are none.
const POLL_MS = 4000;

export function AdoptableSessions({ canOpen }: { canOpen: boolean }) {
  const client = useFleetConnection((s) => s.client);
  const [sessions, setSessions] = useState<AdoptableSession[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const raw = await (await client()).presence();
        if (alive) setSessions(adoptableSessions(normalizePresence(raw)));
      } catch {
        // keep the last list on a transient failure
      }
    };
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [client]);

  if (sessions.length === 0) return null;

  const adopt = async (s: AdoptableSession) => {
    if (busy) return;
    setBusy(s.key);
    setErr(null);
    try {
      const res = await (await client()).adopt(s.harness, s.sessionId, s.cwd);
      if (!res.ok) {
        setErr(res.reason ?? "adopt failed");
        return;
      }
      if (canOpen && res.agent?.worktree) {
        getWorktreeOpener()?.open({
          name: res.agent.name || "adopted",
          worktree: res.agent.worktree,
        });
      }
      // Drop it optimistically; the next poll reconciles.
      setSessions((cur) => cur.filter((x) => x.key !== s.key));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "adopt failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
        Ad-hoc sessions ({sessions.length})
      </div>
      {sessions.map((s) => (
        <div
          key={s.key}
          className="flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5 dark:border-gray-800"
        >
          <span
            className="size-1.5 shrink-0 rounded-full bg-sky-500"
            aria-hidden
          />
          <span className="truncate text-[12px] font-medium text-gray-800 dark:text-gray-100">
            {s.harness}
          </span>
          <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">
            {s.repoName}
            {s.host ? ` · ${s.host}` : ""}
          </span>
          <button
            type="button"
            onClick={() => void adopt(s)}
            disabled={busy === s.key}
            title="Capture this session's work into a new fleet unit"
            className="ml-auto shrink-0 rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {busy === s.key ? "Adopting…" : "Adopt"}
          </button>
        </div>
      ))}
      {err && <div className="text-[11px] text-red-500">{err}</div>}
    </section>
  );
}
