// Typed client for a glance daemon's REST surface. C04 is the SKELETON: connection +
// auth + health only; the roster/attention reads land in C05. Plain `fetch` to a
// loopback daemon — glance's CSP `connect-src` already allows http://127.0.0.1:* and
// http://localhost:* (verified during the fork bootstrap), so no Rust proxy is needed
// for same-host daemons. A remote/https daemon is a later concern (Epic M).

import { fleetFetch } from "./fleetFetch";

export type FleetHealth =
  | { status: "connected"; detail: string }
  | { status: "unauthorized"; detail: string }
  | { status: "unreachable"; detail: string };

/** Thrown by roster()/fabricSearch() on 401/403 so callers can distinguish auth failure from unreachable. */
export class FleetAuthError extends Error {}

/** Outcome of a friction capture (C3 "grr"). `unauthorized` is split out so the modal can show the
 *  "check the token in Settings → Fleet" copy — POST /api/friction is operator-tier. */
export type GrrResult =
  | { ok: true }
  | { ok: false; unauthorized: boolean; detail: string };

/** One ranked hit from GET /api/fabric/search (C4). Mirrors the daemon's `FabricSearchResult`
 *  (omp-squad src/fabric-search.ts). `type` is a KB doc type — decision / hot-area / digest /
 *  agent / scout / lease / failure / symptom / episode / answer. */
export interface FabricHit {
  type: string;
  id: string;
  title: string;
  snippet: string;
  score: number;
  repo?: string;
  ref?: string;
  source?: string;
}

export interface FleetClientConfig {
  /** e.g. "http://127.0.0.1:7878" — no trailing slash. */
  baseUrl: string;
  /** Bearer token from the keyring; omitted when the daemon runs tokenless (loopback). */
  token?: string | null;
}

/** Normalize a user-typed base: default scheme http://, strip a trailing slash. */
export function normalizeBaseUrl(raw: string): string {
  const t = raw.trim().replace(/\/+$/, "");
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `http://${t}`;
}

export class FleetClient {
  constructor(private readonly config: FleetClientConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.config.token) h.authorization = `Bearer ${this.config.token}`;
    return h;
  }

  /** GET against the daemon, returning the raw Response (caller maps status). */
  async get(path: string, signal?: AbortSignal): Promise<Response> {
    return fleetFetch(`${this.config.baseUrl}${path}`, {
      headers: this.headers(),
      signal,
    });
  }

  /**
   * Roster snapshot from GET /api/agents. Throws on a transport failure (→ the poller shows
   * "reconnecting" and keeps the last good roster); throws a tagged error on 401/403 so the
   * poller can surface "unauthorized" distinctly from "unreachable".
   */
  async roster(signal?: AbortSignal): Promise<unknown> {
    const res = await this.get("/api/agents", signal);
    if (res.status === 401 || res.status === 403) {
      throw new FleetAuthError(`daemon refused the token (${res.status})`);
    }
    if (!res.ok) throw new Error(`roster fetch failed: ${res.status}`);
    return res.json();
  }

  /** Unified diff per changed file in a unit's worktree — GET /api/agents/:id/diff → FileDiff[]. */
  async diff(id: string, signal?: AbortSignal): Promise<unknown> {
    const res = await this.get(
      `/api/agents/${encodeURIComponent(id)}/diff`,
      signal,
    );
    if (!res.ok) throw new Error(`diff fetch failed: ${res.status}`);
    return res.json();
  }

  /** A unit's transcript — GET /api/agents/:id/transcript[?since=seq]. With `since`, only the
   *  delta (entries newer than that seq) is returned (I01); the conversation pane polls it. */
  async transcript(
    id: string,
    since?: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const q = since !== undefined ? `?since=${since}` : "";
    const res = await this.get(
      `/api/agents/${encodeURIComponent(id)}/transcript${q}`,
      signal,
    );
    if (!res.ok) throw new Error(`transcript fetch failed: ${res.status}`);
    return res.json();
  }

  /** File leases for a repo — GET /api/leases?repo → LeaseEntry[] (who holds which file). The
   *  overlay (I04) reads these; repo-level GET /api/presence lands with I05 when the human's own
   *  presence write matters. */
  async leases(repo: string, signal?: AbortSignal): Promise<unknown> {
    const res = await this.get(
      `/api/leases?repo=${encodeURIComponent(repo)}`,
      signal,
    );
    if (!res.ok) throw new Error(`leases fetch failed: ${res.status}`);
    return res.json();
  }

  /** Presence rows — GET /api/presence[?repo] → PresenceEntry[]. Ad-hoc CLI sessions reported by B03
   *  harness-hooks appear here as `source:"other"` with an `agent` label `harness:sessionId`; the
   *  adopt surface (E03) reads these to find sessions it can pull into the fleet. */
  async presence(repo?: string, signal?: AbortSignal): Promise<unknown> {
    const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
    const res = await this.get(`/api/presence${q}`, signal);
    if (!res.ok) throw new Error(`presence fetch failed: ${res.status}`);
    return res.json();
  }

  /** Adopt an ad-hoc CLI session into a fleet unit (E03) — POST /api/agents/adopt {harness, sessionId,
   *  cwd}. The daemon captures the session's uncommitted work into a fresh worktree, leaves the
   *  developer's checkout untouched, and returns the new unit. `{ok, reason?, agent?}`. */
  async adopt(
    harness: string,
    sessionId: string,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean;
    reason?: string;
    agent?: { id: string; name: string; worktree?: string };
  }> {
    const res = await fleetFetch(`${this.config.baseUrl}/api/agents/adopt`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ harness, sessionId, cwd }),
      signal,
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      reason?: string;
      agent?: { id: string; name: string; worktree?: string };
    } | null;
    if (!body) return { ok: false, reason: `adopt failed (${res.status})` };
    return { ok: body.ok === true, reason: body.reason, agent: body.agent };
  }

  /** Interrupt a unit's current turn — POST /api/command {type:"interrupt"} → ACP session/cancel.
   *  Used by "Take over" (I05) to quiesce the agent so the human drives. */
  async interrupt(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; detail?: string }> {
    const res = await fleetFetch(`${this.config.baseUrl}/api/command`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ type: "interrupt", id }),
      signal,
    });
    return res.ok ? { ok: true } : { ok: false, detail: `${res.status}` };
  }

  /** Set a unit's autonomy mode — POST /api/agents/:id/mode {mode}. "Take over" → observe;
   *  "Hand back" restores the prior mode (I05). */
  async setMode(
    id: string,
    mode: string,
    reason?: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; detail?: string }> {
    const res = await fleetFetch(
      `${this.config.baseUrl}/api/agents/${encodeURIComponent(id)}/mode`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ mode, reason }),
        signal,
      },
    );
    return res.ok ? { ok: true } : { ok: false, detail: `${res.status}` };
  }

  /** Promote a daemon-backed chat (a console unit) into a working, landable unit IN PLACE (E02) —
   *  POST /api/agents/:id/promote {task?, mode?}. The daemon clears the console restriction, keeps the
   *  worktree + transcript, and steers the task into the same session. Returns {ok, reason?, agent?}. */
  async promote(
    id: string,
    opts: { task?: string; mode?: string },
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean;
    reason?: string;
    agent?: { id: string; name: string; worktree?: string };
  }> {
    const res = await fleetFetch(
      `${this.config.baseUrl}/api/agents/${encodeURIComponent(id)}/promote`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(opts),
        signal,
      },
    );
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      reason?: string;
      agent?: { id: string; name: string; worktree?: string };
    } | null;
    if (!body) return { ok: false, reason: `promote failed (${res.status})` };
    return {
      ok: body.ok === true,
      reason: body.reason,
      agent: body.agent,
    };
  }

  /** Claim presence for a worktree (I02's write) — POST /api/presence → { id }. Used by "Take over"
   *  to register the human as present. Returns the claim id to release on hand-back. */
  async claimPresence(
    repo: string,
    agent: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const res = await fleetFetch(`${this.config.baseUrl}/api/presence`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ repo, agent }),
      signal,
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return body?.id ?? null;
  }

  /** Release a presence claim — DELETE /api/presence?id&repo (I02's write). "Hand back" (I05). */
  async releasePresence(
    id: string,
    repo: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await fleetFetch(
      `${this.config.baseUrl}/api/presence?id=${encodeURIComponent(id)}&repo=${encodeURIComponent(repo)}`,
      {
        method: "DELETE",
        headers: this.headers(),
        signal,
      },
    ).catch(() => {});
  }

  /** Create a lightweight "console" chat unit — POST /api/console {repo, model?, profileId?} → { agentId }.
   *  The daemon-backed chat (E01) lazily creates one on the first turn; the agentId is remembered so
   *  every turn steers the SAME unit (and so E02 can promote it in place). Returns null on failure. */
  async createConsole(
    repo: string,
    model?: string,
    profileId?: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const res = await fleetFetch(`${this.config.baseUrl}/api/console`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ repo, model, profileId }),
      signal,
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      agentId?: string;
    } | null;
    return body?.agentId ?? null;
  }

  /**
   * Capture a dogfooding gripe (C3 "grr") — POST /api/friction {repo, context:"desktop", gripe},
   * the same body shape `glance grr` and the daemon TUI's Ctrl-G send. Operator-tier, so a daemon
   * with auth configured answers 401/403 without a valid token; that's surfaced distinctly so the
   * modal can point the user at Settings → Fleet rather than reading as a generic failure.
   */
  async grr(
    repo: string,
    gripe: string,
    signal?: AbortSignal,
  ): Promise<GrrResult> {
    const res = await fleetFetch(`${this.config.baseUrl}/api/friction`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ repo, context: "desktop", gripe }),
      signal,
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        unauthorized: true,
        detail: `daemon refused the token (${res.status}) — check the token in Settings → Fleet`,
      };
    }
    return {
      ok: false,
      unauthorized: false,
      detail: `${res.status}: ${await res.text().catch(() => "friction capture failed")}`,
    };
  }

  /**
   * Search the fleet knowledge base (C4) — GET /api/fabric/search?q&topK → {query, results}. The
   * daemon BM25-ranks the context fabric and returns the top `topK` hits (default 20). Throws a
   * tagged error on 401/403 (viewer-tier, but a token-guarded daemon still refuses) so the hook
   * surfaces an auth failure; throws on any other non-2xx / transport failure.
   */
  async fabricSearch(
    q: string,
    opts: { topK?: number } = {},
    signal?: AbortSignal,
  ): Promise<FabricHit[]> {
    const topK = opts.topK ?? 20;
    const res = await this.get(
      `/api/fabric/search?q=${encodeURIComponent(q)}&topK=${topK}`,
      signal,
    );
    if (res.status === 401 || res.status === 403) {
      throw new FleetAuthError(`daemon refused the token (${res.status})`);
    }
    if (!res.ok) throw new Error(`fabric search failed: ${res.status}`);
    const body = (await res.json().catch(() => null)) as {
      results?: FabricHit[];
    } | null;
    return Array.isArray(body?.results) ? body.results : [];
  }

  /**
   * Steer a unit — POST /api/command {type:"prompt"}, the same shape the webapp sends. This is
   * an operator-tier WRITE (it spends model tokens and drives the agent), so it needs a token
   * when the daemon has auth configured. Returns the daemon's response text on failure.
   */
  async steer(
    id: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; detail?: string }> {
    const res = await fleetFetch(`${this.config.baseUrl}/api/command`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ type: "prompt", id, message }),
      signal,
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      detail: `${res.status}: ${await res.text().catch(() => "steer failed")}`,
    };
  }

  /**
   * Probe reachability + auth in one call. `/api/auth/check` is viewer-tier on the daemon,
   * so it answers 200 when the token is accepted, 401/403 when it isn't, and throws (network)
   * when nothing is listening — mapping cleanly onto the three connection states the pane shows.
   */
  async health(signal?: AbortSignal): Promise<FleetHealth> {
    let res: Response;
    try {
      res = await this.get("/api/auth/check", signal);
    } catch (err) {
      return {
        status: "unreachable",
        detail: err instanceof Error ? err.message : "no daemon is listening",
      };
    }
    if (res.ok)
      return {
        status: "connected",
        detail: `daemon reachable (${res.status})`,
      };
    if (res.status === 401 || res.status === 403) {
      return {
        status: "unauthorized",
        detail: `daemon refused the token (${res.status}) — check the token in Settings → Fleet`,
      };
    }
    return {
      status: "unreachable",
      detail: `unexpected response ${res.status}`,
    };
  }
}
