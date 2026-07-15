// Typed client for a glance daemon's REST surface. C04 is the SKELETON: connection +
// auth + health only; the roster/attention reads land in C05. Plain `fetch` to a
// loopback daemon — terax's CSP `connect-src` already allows http://127.0.0.1:* and
// http://localhost:* (verified during the fork bootstrap), so no Rust proxy is needed
// for same-host daemons. A remote/https daemon is a later concern (Epic M).

export type FleetHealth =
  | { status: "connected"; detail: string }
  | { status: "unauthorized"; detail: string }
  | { status: "unreachable"; detail: string };

/** Thrown by roster() on 401/403 so the poller can distinguish auth failure from unreachable. */
export class FleetAuthError extends Error {}

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
    return fetch(`${this.config.baseUrl}${path}`, {
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
    const res = await fetch(`${this.config.baseUrl}/api/command`, {
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
