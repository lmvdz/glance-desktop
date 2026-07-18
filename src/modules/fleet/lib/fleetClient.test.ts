import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetAuthError, FleetClient, normalizeBaseUrl } from "./fleetClient";

describe("normalizeBaseUrl", () => {
  it("defaults the scheme to http and strips trailing slashes", () => {
    expect(normalizeBaseUrl("127.0.0.1:7878")).toBe("http://127.0.0.1:7878");
    expect(normalizeBaseUrl("http://localhost:7878/")).toBe(
      "http://localhost:7878",
    );
    expect(normalizeBaseUrl("https://fleet.example.com//")).toBe(
      "https://fleet.example.com",
    );
    expect(normalizeBaseUrl("  ")).toBe("");
  });
});

describe("FleetClient.health", () => {
  afterEach(() => vi.restoreAllMocks());

  const client = (token?: string) =>
    new FleetClient({ baseUrl: "http://127.0.0.1:7878", token });

  it("maps 200 → connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    expect((await client("t").health()).status).toBe("connected");
  });

  it("maps 401/403 → unauthorized (a token problem, not a reachability one)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 401 })),
    );
    expect((await client("bad").health()).status).toBe("unauthorized");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 403 })),
    );
    expect((await client("bad").health()).status).toBe("unauthorized");
  });

  it("maps a thrown fetch (nothing listening) → unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const h = await client().health();
    expect(h.status).toBe("unreachable");
    expect(h.detail).toContain("Failed to fetch");
  });

  it("maps an unexpected status → unreachable, not connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    expect((await client("t").health()).status).toBe("unreachable");
  });

  it("sends a bearer header only when a token is present", async () => {
    const spy = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    vi.stubGlobal("fetch", spy);

    await client("secret").health();
    expect(spy.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer secret",
    });

    spy.mockClear();
    await client().health();
    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });
});

describe("FleetClient.grr", () => {
  afterEach(() => vi.restoreAllMocks());

  const client = (token?: string) =>
    new FleetClient({ baseUrl: "http://127.0.0.1:7878", token });

  it("POSTs {repo, context:'desktop', gripe} to /api/friction", async () => {
    const spy = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    vi.stubGlobal("fetch", spy);

    const res = await client("t").grr("/home/me/repo", "  it lags  ");
    expect(res.ok).toBe(true);

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:7878/api/friction");
    expect(init?.method).toBe("POST");
    // The gripe is sent verbatim — trimming is the modal's job, not the client's.
    expect(JSON.parse(init?.body as string)).toEqual({
      repo: "/home/me/repo",
      context: "desktop",
      gripe: "  it lags  ",
    });
  });

  it("splits out 401/403 as unauthorized with the Settings → Fleet hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 401 })),
    );
    const res = await client("bad").grr("/repo", "x");
    expect(res).toMatchObject({ ok: false, unauthorized: true });
    if (!res.ok) expect(res.detail).toContain("Settings → Fleet");
  });

  it("reports other failures without the unauthorized flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const res = await client("t").grr("/repo", "x");
    expect(res).toMatchObject({ ok: false, unauthorized: false });
  });
});

describe("FleetClient.fabricSearch", () => {
  afterEach(() => vi.restoreAllMocks());

  const client = (token?: string) =>
    new FleetClient({ baseUrl: "http://127.0.0.1:7878", token });

  it("GETs /api/fabric/search with an encoded query and default topK 20", async () => {
    const spy = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ query: "x", results: [] }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal("fetch", spy);

    await client("t").fabricSearch("token rotation");
    expect(spy.mock.calls[0][0]).toBe(
      "http://127.0.0.1:7878/api/fabric/search?q=token%20rotation&topK=20",
    );
  });

  it("honors an explicit topK", async () => {
    const spy = vi.fn((_url: string) =>
      Promise.resolve(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", spy);

    await client().fabricSearch("q", { topK: 5 });
    expect(spy.mock.calls[0][0]).toContain("topK=5");
  });

  it("returns the results array, tolerating a malformed body", async () => {
    const hit = {
      type: "decision",
      id: "d1",
      title: "token rotation",
      snippet: "rotate keys",
      score: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ results: [hit] }))),
    );
    expect(await client().fabricSearch("q")).toEqual([hit]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    expect(await client().fabricSearch("q")).toEqual([]);
  });

  it("throws FleetAuthError on 401/403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 403 })),
    );
    await expect(client("bad").fabricSearch("q")).rejects.toBeInstanceOf(
      FleetAuthError,
    );
  });
});
