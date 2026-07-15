import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEYRING_SERVICE, LEGACY_KEYRING_SERVICE } from "../config";

// In-memory fake backing the `secrets_get`/`secrets_set`/`secrets_delete`
// Tauri commands, keyed exactly like the real Rust side (service::account).
// Lets the highest-stakes migration in this concern — API keys — be
// exercised end-to-end without a real OS keychain.
const fake = new Map<string, string>();
const key = (service: string, account: string) => `${service}::${account}`;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    const { service, account } = args as { service: string; account: string };
    if (cmd === "secrets_get") return fake.get(key(service, account)) ?? null;
    if (cmd === "secrets_set") {
      fake.set(key(service, account), args.password as string);
      return undefined;
    }
    if (cmd === "secrets_delete") {
      fake.delete(key(service, account));
      return undefined;
    }
    throw new Error(`unexpected command: ${cmd}`);
  }),
}));

const { migrateKeyringAccount } = await import("./keyring");

beforeEach(() => {
  fake.clear();
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
});
