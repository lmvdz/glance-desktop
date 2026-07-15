import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fleetKeyring's `getDaemonToken`/`setFleetToken`/etc. are thin wrappers over
// `invoke("secrets_*", …)` plus a one-time legacy-token migration keyed off the active
// daemon id from fleetConfig. Mock both seams so the migration decision (the one bit of
// real logic in this module) is exercised without a real keychain or Tauri store.

const invokeMock = vi.fn();
const getActiveDaemonIdMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./fleetConfig", () => ({
  getActiveDaemonId: () => getActiveDaemonIdMock(),
}));

// The module tracks "have we tried the legacy migration yet" as module-level state, so
// each test needs a fresh module instance to observe the migration in isolation.
async function freshKeyring() {
  vi.resetModules();
  return import("./fleetKeyring");
}

describe("fleetKeyring — per-daemon tokens + legacy migration", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    getActiveDaemonIdMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("getDaemonToken returns the id-scoped token when the keyring has one", async () => {
    const { getDaemonToken } = await freshKeyring();
    invokeMock.mockImplementation(async (cmd: string, args: { account: string }) => {
      if (cmd === "secrets_get" && args.account === "fleet-daemon-token:abc") {
        return "scoped-token";
      }
      return null;
    });

    expect(await getDaemonToken("abc")).toBe("scoped-token");
    // No legacy lookup was needed — the scoped token already satisfied the call.
    expect(
      invokeMock.mock.calls.some(
        ([, args]) => (args as { account: string }).account === "fleet-daemon-token",
      ),
    ).toBe(false);
  });

  it("migrates the legacy unscoped token into the active daemon's account, once, then clears it", async () => {
    const { getDaemonToken } = await freshKeyring();
    getActiveDaemonIdMock.mockResolvedValue("active-id");

    const store = new Map<string, string>();
    invokeMock.mockImplementation(
      async (cmd: string, args: { account: string; password?: string }) => {
        if (cmd === "secrets_get") return store.get(args.account) ?? null;
        if (cmd === "secrets_set") {
          store.set(args.account, args.password as string);
          return undefined;
        }
        if (cmd === "secrets_delete") {
          store.delete(args.account);
          return undefined;
        }
        throw new Error(`unexpected invoke ${cmd}`);
      },
    );
    store.set("fleet-daemon-token", "legacy-token");

    const token = await getDaemonToken("active-id");
    expect(token).toBe("legacy-token");
    expect(store.get("fleet-daemon-token:active-id")).toBe("legacy-token");
    expect(store.has("fleet-daemon-token")).toBe(false);
  });

  it("does not migrate the legacy token into a NON-active daemon id", async () => {
    const { getDaemonToken } = await freshKeyring();
    getActiveDaemonIdMock.mockResolvedValue("some-other-active-id");

    const store = new Map<string, string>();
    store.set("fleet-daemon-token", "legacy-token");
    invokeMock.mockImplementation(
      async (cmd: string, args: { account: string; password?: string }) => {
        if (cmd === "secrets_get") return store.get(args.account) ?? null;
        if (cmd === "secrets_set") {
          store.set(args.account, args.password as string);
          return undefined;
        }
        if (cmd === "secrets_delete") {
          store.delete(args.account);
          return undefined;
        }
        throw new Error(`unexpected invoke ${cmd}`);
      },
    );

    const token = await getDaemonToken("queried-id");
    expect(token).toBeNull();
    expect(store.get("fleet-daemon-token")).toBe("legacy-token");
  });

  it("getFleetToken/setFleetToken/clearFleetToken route through the active daemon's id", async () => {
    const { getFleetToken, setFleetToken, clearFleetToken } =
      await freshKeyring();
    getActiveDaemonIdMock.mockResolvedValue("active-id");

    const store = new Map<string, string>();
    invokeMock.mockImplementation(
      async (cmd: string, args: { account: string; password?: string }) => {
        if (cmd === "secrets_get") return store.get(args.account) ?? null;
        if (cmd === "secrets_set") {
          store.set(args.account, args.password as string);
          return undefined;
        }
        if (cmd === "secrets_delete") {
          store.delete(args.account);
          return undefined;
        }
        throw new Error(`unexpected invoke ${cmd}`);
      },
    );

    await setFleetToken("a-token");
    expect(store.get("fleet-daemon-token:active-id")).toBe("a-token");
    expect(await getFleetToken()).toBe("a-token");

    await clearFleetToken();
    expect(store.has("fleet-daemon-token:active-id")).toBe(false);
    expect(await getFleetToken()).toBeNull();
  });

  it("getFleetToken returns null when there is no active daemon (nothing configured yet)", async () => {
    const { getFleetToken } = await freshKeyring();
    getActiveDaemonIdMock.mockResolvedValue(null);
    expect(await getFleetToken()).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
