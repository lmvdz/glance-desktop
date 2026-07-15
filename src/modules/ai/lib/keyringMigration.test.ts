import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEYRING_SERVICE, LEGACY_KEYRING_SERVICE } from "../config";

// In-memory fake backing the `secrets_get`/`secrets_set`/`secrets_delete`
// Tauri commands, keyed exactly like the real Rust side (service::account).
// Lets the highest-stakes migration in this concern — API keys — be
// exercised end-to-end without a real OS keychain.
const fake = new Map<string, string>();
const key = (service: string, account: string) => `${service}::${account}`;

/** Lets a test make the NEXT N `secrets_get` reads for a given
 *  service+account throw, to simulate a transient keyring read error. */
const failReadsRemaining = new Map<string, number>();

/** Lets a test hold a specific `cmd:service:account` call open until it
 *  manually releases it, to prove a concurrent caller genuinely waits
 *  rather than racing ahead of an in-flight migration. */
const blockers = new Map<string, Promise<void>>();

async function defaultInvokeImpl(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const { service, account } = args as { service: string; account: string };
  const k = key(service, account);
  const blocker = blockers.get(`${cmd}:${k}`);
  if (blocker) await blocker;
  if (cmd === "secrets_get") {
    const remaining = failReadsRemaining.get(k) ?? 0;
    if (remaining > 0) {
      failReadsRemaining.set(k, remaining - 1);
      throw new Error("simulated keyring read error");
    }
    return fake.get(k) ?? null;
  }
  if (cmd === "secrets_set") {
    fake.set(k, args.password as string);
    return undefined;
  }
  if (cmd === "secrets_delete") {
    fake.delete(k);
    return undefined;
  }
  throw new Error(`unexpected command: ${cmd}`);
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: unknown) =>
    defaultInvokeImpl(cmd, args as Record<string, unknown>),
  ),
}));

const { migrateKeyringAccount, getKey, setKey, clearKey } =
  await import("./keyring");
const { invoke } = await import("@tauri-apps/api/core");
const invokeMock = vi.mocked(invoke);
// `invoke`'s real signature accepts `InvokeArgs | undefined` (a wider type
// than the `Record<string, unknown>` this fake actually needs); cast once
// here rather than loosen `defaultInvokeImpl`'s own signature everywhere.
const defaultImpl = defaultInvokeImpl as unknown as typeof invoke;

beforeEach(() => {
  fake.clear();
  failReadsRemaining.clear();
  blockers.clear();
  invokeMock.mockImplementation(defaultImpl);
});

describe("migrateKeyringAccount", () => {
  it("copies an old-service key to the new service and clears the old one", async () => {
    fake.set(key(LEGACY_KEYRING_SERVICE, "openai-api-key"), "sk-legacy");
    await migrateKeyringAccount("openai-api-key");
    expect(fake.get(key(KEYRING_SERVICE, "openai-api-key"))).toBe("sk-legacy");
    expect(fake.has(key(LEGACY_KEYRING_SERVICE, "openai-api-key"))).toBe(false);
  });

  it("is idempotent — running twice is a no-op the second time", async () => {
    fake.set(key(LEGACY_KEYRING_SERVICE, "openai-api-key"), "sk-legacy");
    await migrateKeyringAccount("openai-api-key");
    await migrateKeyringAccount("openai-api-key");
    expect(fake.get(key(KEYRING_SERVICE, "openai-api-key"))).toBe("sk-legacy");
    expect(fake.has(key(LEGACY_KEYRING_SERVICE, "openai-api-key"))).toBe(false);
  });

  it("never overwrites a key the user already has under the new service", async () => {
    fake.set(key(KEYRING_SERVICE, "openai-api-key"), "sk-current");
    fake.set(key(LEGACY_KEYRING_SERVICE, "openai-api-key"), "sk-legacy");
    await migrateKeyringAccount("openai-api-key");
    expect(fake.get(key(KEYRING_SERVICE, "openai-api-key"))).toBe("sk-current");
    // Old key is left alone too — we only ever clear it after copying it.
    expect(fake.get(key(LEGACY_KEYRING_SERVICE, "openai-api-key"))).toBe(
      "sk-legacy",
    );
  });

  it("does nothing when neither service has the key", async () => {
    await migrateKeyringAccount("openai-api-key");
    expect(fake.has(key(KEYRING_SERVICE, "openai-api-key"))).toBe(false);
  });

  it("is a no-op for accounts local-only providers use (empty account string)", async () => {
    await migrateKeyringAccount("");
    expect(fake.size).toBe(0);
  });

  it("a transient NEW-service read error aborts the migration instead of clobbering a good key", async () => {
    fake.set(key(KEYRING_SERVICE, "openai-api-key"), "sk-good");
    fake.set(key(LEGACY_KEYRING_SERVICE, "openai-api-key"), "sk-legacy");
    // The read of the NEW service (not the old one) fails exactly once.
    failReadsRemaining.set(key(KEYRING_SERVICE, "openai-api-key"), 1);

    // Old, buggy behavior: `.catch(() => null)` on that read would make
    // this look like "new service has no key", triggering a migration
    // that overwrites "sk-good" with the stale "sk-legacy" and deletes the
    // legacy entry. Fixed behavior: the error propagates, the whole
    // migration attempt aborts, and nothing is touched.
    await expect(migrateKeyringAccount("openai-api-key")).rejects.toThrow();
    expect(fake.get(key(KEYRING_SERVICE, "openai-api-key"))).toBe("sk-good");
    expect(fake.get(key(LEGACY_KEYRING_SERVICE, "openai-api-key"))).toBe(
      "sk-legacy",
    );
  });

  it("a new-must-win recheck aborts the write if a concurrent set landed after the initial read", async () => {
    // Simulates the narrow window between migrateKeyringAccount's initial
    // parallel read (which sees the new service as empty) and its write:
    // this makes that FIRST new-service read return null, but — as if a
    // concurrent `setKey` had landed in between — the fake map already has
    // a real value by the time the recheck fires.
    fake.set(key(LEGACY_KEYRING_SERVICE, "groq-api-key"), "sk-legacy");
    let reads = 0;
    invokeMock.mockImplementation(async (cmd, args) => {
      const { service, account } = args as {
        service: string;
        account: string;
      };
      if (
        cmd === "secrets_get" &&
        service === KEYRING_SERVICE &&
        account === "groq-api-key"
      ) {
        reads++;
        if (reads === 1) {
          // Simulate the race: a concurrent set landed right after this
          // read was taken.
          fake.set(key(KEYRING_SERVICE, account), "sk-raced-in");
          return null;
        }
      }
      return defaultInvokeImpl(cmd, args as unknown as Record<string, unknown>);
    });

    await migrateKeyringAccount("groq-api-key");
    // The recheck must have seen "sk-raced-in" and aborted — the legacy
    // value must never have overwritten it.
    expect(fake.get(key(KEYRING_SERVICE, "groq-api-key"))).toBe(
      "sk-raced-in",
    );
  });
});

describe("keyring get/set/clear (gated entrypoints)", () => {
  it("clearKey clears the legacy account too (no resurrection on next migrate)", async () => {
    fake.set(key(KEYRING_SERVICE, "openai-api-key"), "sk-current");
    fake.set(key(LEGACY_KEYRING_SERVICE, "openai-api-key"), "sk-legacy-stale");

    await clearKey("openai");
    expect(fake.has(key(KEYRING_SERVICE, "openai-api-key"))).toBe(false);
    expect(fake.has(key(LEGACY_KEYRING_SERVICE, "openai-api-key"))).toBe(
      false,
    );

    // A later migration attempt must not resurrect the key the user just
    // cleared — clearing only the new service used to leave the legacy
    // entry intact for exactly this to happen.
    await migrateKeyringAccount("openai-api-key");
    expect(fake.has(key(KEYRING_SERVICE, "openai-api-key"))).toBe(false);
  });

  it("getKey and setKey for the same account share one in-flight migration — the second caller waits, it doesn't race ahead", async () => {
    fake.set(key(LEGACY_KEYRING_SERVICE, "anthropic-api-key"), "sk-legacy");

    // Hold the migration's OWN write open so we can prove `setKey` — fired
    // concurrently, without awaiting `getKey` first — is genuinely blocked
    // on that same in-flight attempt, not short-circuiting past a "started"
    // flag the way the pre-fix mark-before-await code did (which let a
    // concurrent caller act on the keyring before the migration had
    // actually copied anything).
    let unblock!: () => void;
    const blocker = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    blockers.set(
      `secrets_set:${key(KEYRING_SERVICE, "anthropic-api-key")}`,
      blocker,
    );

    let setKeyResolved = false;
    const getPromise = getKey("anthropic");
    const setPromise = setKey("anthropic", "sk-typed-by-user").then(() => {
      setKeyResolved = true;
    });

    // Let both calls run their synchronous-until-first-await prefix
    // (including the "already in flight?" gate check) without releasing
    // the blocked write.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(setKeyResolved).toBe(false);

    unblock();
    await Promise.all([getPromise, setPromise]);
    expect(setKeyResolved).toBe(true);
    // setKey's write is the only write left once the shared migration
    // resolves (getKey only reads), so it deterministically wins.
    expect(fake.get(key(KEYRING_SERVICE, "anthropic-api-key"))).toBe(
      "sk-typed-by-user",
    );
    expect(fake.has(key(LEGACY_KEYRING_SERVICE, "anthropic-api-key"))).toBe(
      false,
    );
  });
});
