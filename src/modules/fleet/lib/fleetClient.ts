// Typed client for a glance daemon's REST surface. C04 is the SKELETON: connection +
// auth + health only; the roster/attention reads land in C05. Plain `fetch` to a
// loopback daemon — terax's CSP `connect-src` already allows http://127.0.0.1:* and
// http://localhost:* (verified during the fork bootstrap), so no Rust proxy is needed
// for same-host daemons. A remote/https daemon is a later concern (Epic M).

export type FleetHealth =
  | { status: "connected"; detail: string }
  | { status: "unauthorized"; detail: string }
  | { status: "unreachable"; detail: string };

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
