import { invoke } from "@tauri-apps/api/core";

// The fleet daemon is CROSS-ORIGIN to the cockpit (the Tauri webview origin is `tauri://localhost`;
// the daemon lives at http://127.0.0.1:PORT, a LAN IP, or a tailnet host) and the daemon sends NO CORS
// headers, so a plain browser `fetch` is rejected by WebKitGTK before the response can be read —
// surfacing as "Load failed". Route fleet HTTP through the Rust reqwest proxy `ai_http_request`
// (already registered) which, running in Rust, is not subject to browser CORS or CSP. `connect-src`
// only governs the WEBVIEW making a request; nothing browser-side governs a Rust request.
//
// `allowPrivateNetwork: true` (Lars-approved 2026-07-15 — "disable the SSRF guard for fleet-daemon
// traffic"): the fleet's daemons live on private addresses BY DESIGN — loopback locally, LAN or
// Tailscale CGNAT (100.64.0.0/10) remotely — which is exactly the space `ai_http_request`'s SSRF guard
// blocks by default. The URL is always a daemon the user configured in Settings → Fleet (never
// arbitrary/remote input), and over Tailscale the transport is itself device-authenticated, so this is
// "reach the private daemon you configured", bounded to fleet traffic. Outside a Tauri webview (vitest
// / any non-Tauri host) we fall through to global `fetch`, so tests that stub `fetch` and any web build
// keep working unchanged.

interface FleetFetchInit {
  method?: string;
  headers?: Record<string, string>;
  /** A JSON string body (what FleetClient sends); encoded to bytes for the Rust proxy. */
  body?: string;
  signal?: AbortSignal;
}

interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  /** Response bytes from the Rust `HttpResponse.body: Vec<u8>`. */
  body: number[];
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Statuses that must have a null body per the Fetch spec (Response would throw otherwise). */
function isNullBodyStatus(status: number): boolean {
  return (
    status === 204 ||
    status === 205 ||
    status === 304 ||
    (status >= 100 && status < 200)
  );
}

/**
 * A `fetch`-shaped call that goes through the Rust HTTP proxy inside a Tauri webview (bypassing browser
 * CORS/CSP) and through global `fetch` everywhere else. Returns a real `Response`, so callers use
 * `res.ok`/`res.status`/`res.json()`/`res.text()` unchanged. NOTE: the Tauri path can't cancel an
 * in-flight request, so `signal` only short-circuits before dispatch — a poll that aborts mid-request
 * lets it complete and discards the result (fine for the fleet's lightweight polls).
 */
export async function fleetFetch(
  url: string,
  init?: FleetFetchInit,
): Promise<Response> {
  if (!inTauri()) {
    return fetch(url, init as RequestInit);
  }
  if (init?.signal?.aborted) {
    throw new DOMException("Request aborted", "AbortError");
  }
  const bodyBytes =
    init?.body != null
      ? Array.from(new TextEncoder().encode(init.body))
      : undefined;
  const res = await invoke<ProxyResponse>("ai_http_request", {
    url,
    method: init?.method ?? "GET",
    headers: init?.headers ?? {},
    body: bodyBytes,
    allowPrivateNetwork: true,
  });
  return new Response(
    isNullBodyStatus(res.status) ? null : new Uint8Array(res.body),
    { status: res.status, headers: res.headers },
  );
}
