// Ad-hoc session polling, extracted from the old AdoptableSessions widget (fleet-ide-escalation
// E03) so the thread spine can render sessions as ROWS in the grouped list (t3-face concern 05)
// instead of a separate panel above the roster. Logic is unchanged from the widget: polls the
// ACTIVE daemon's presence list directly (not the merged roster), so its own worktree-open gate
// stays keyed off the active connection, exactly like before.

import { useEffect, useState } from "react";
import {
  type AdoptableSession,
  adoptableSessions,
  normalizePresence,
} from "../../lib/fleetAdopt";
import { getWorktreeOpener } from "../../lib/worktreeOpener";
import { useFleetConnection } from "../../store/fleetConnectionStore";

const POLL_MS = 4000;

export function useAdoptableSessions(canOpen: boolean): {
  sessions: AdoptableSession[];
  busy: string | null;
  err: string | null;
  adopt: (s: AdoptableSession) => Promise<void>;
} {
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

  return { sessions, busy, err, adopt };
}
