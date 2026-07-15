import { planKeyValueMigration } from "@/modules/migrations/keyValueMigration";
import { createMigrationGate } from "@/modules/migrations/migrationGate";
import { invoke } from "@tauri-apps/api/core";
import {
  getProvider,
  KEYRING_SERVICE,
  LEGACY_KEYRING_SERVICE,
  PROVIDERS,
  providerSupportsKey,
  type CustomEndpoint,
  type ProviderId,
} from "../config";

export type ProviderKeys = Record<ProviderId, string | null>;
export type CustomEndpointKeys = Record<string, string | null>;

export const EMPTY_PROVIDER_KEYS: ProviderKeys = {
  openai: null,
  anthropic: null,
  google: null,
  xai: null,
  cerebras: null,
  groq: null,
  deepseek: null,
  mistral: null,
  openrouter: null,
  "openai-compatible": null,
  lmstudio: null,
  mlx: null,
  ollama: null,
};

/**
 * Highest-stakes migration in this concern: a wrong move here orphans a
 * user's saved API keys. One-time, per-account, read-old-write-new-and-
 * clear-old copy from the pre-rename keyring service (`terax-ai`) into the
 * new one (`glance-ai`) — never the other way, and never overwriting a key
 * that already exists under the new service. The pure "what should happen"
 * decision (`planKeyValueMigration`) is unit-tested; this function is the
 * IO shell around it (secrets_get/set/delete are already generic invoke
 * commands keyed by service+account — no Rust change needed).
 *
 * Neither `secrets_get` above is wrapped in `.catch(() => null)`: a
 * genuine keyring READ ERROR must abort this attempt (propagate to the
 * caller's gate, which retries later — see `keyringGate`), never get
 * misread as "this service has no key". Treating a transient read error as
 * absence used to let it trigger a migration that overwrote a perfectly
 * good new-service key with a stale legacy one.
 */
export async function migrateKeyringAccount(account: string): Promise<void> {
  if (!account) return; // local-only providers (lmstudio/mlx/ollama) have no account
  const [newValue, oldValue] = await Promise.all([
    invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account,
    }),
    invoke<string | null>("secrets_get", {
      service: LEGACY_KEYRING_SERVICE,
      account,
    }),
  ]);
  const plan = planKeyValueMigration(
    newValue && newValue.length > 0 ? newValue : null,
    oldValue && oldValue.length > 0 ? oldValue : null,
  );
  if (!plan.shouldWriteNew) return;
  // New-must-win re-check, immediately before the write: every read/write/
  // clear entrypoint funnels through the same per-account gate (below), so
  // a concurrent `setKey` landing here should be unreachable in practice —
  // this is a cheap, correct backstop in case a future call site ever
  // forgets to gate itself.
  const recheck = await invoke<string | null>("secrets_get", {
    service: KEYRING_SERVICE,
    account,
  });
  if (recheck && recheck.length > 0) return;
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account,
    password: plan.value,
  });
  if (plan.shouldDeleteOld) {
    try {
      await invoke("secrets_delete", {
        service: LEGACY_KEYRING_SERVICE,
        account,
      });
    } catch {
      /* not fatal — the new service already durably has the key */
    }
  }
}

/**
 * Per-account migration gate. Memoizes an in-flight PROMISE (via
 * `createMigrationGate`) rather than a "done" boolean/Set, so every
 * read/write/clear entrypoint for the same account awaits the exact same
 * migration attempt. That fixes two real ways a key used to get lost or
 * clobbered:
 *  - mark-before-await: the old code added the account to a `Set` BEFORE
 *    `migrateKeyringAccount` resolved, so a concurrent `getKey`/`setKey`
 *    for the same account could observe "already migrated" and act on the
 *    keyring before the copy had actually happened;
 *  - a failed migration attempt used to be cached as permanently "done"
 *    (the account was already in the Set), stranding the legacy key
 *    forever with no way to retry.
 *
 * Every entrypoint below (`getKey`, `setKey`, `clearKey`, and their
 * custom-endpoint equivalents) awaits this gate first, so none of them can
 * touch the keyring ahead of — or dodge — this account's migration.
 */
const keyringGates = new Map<string, () => Promise<void>>();

function keyringGate(account: string): () => Promise<void> {
  let gate = keyringGates.get(account);
  if (!gate) {
    gate = createMigrationGate(() => migrateKeyringAccount(account));
    keyringGates.set(account, gate);
  }
  return gate;
}

async function ensureKeyringMigrated(
  accounts: readonly string[],
): Promise<void> {
  await Promise.all(
    accounts
      .filter((a): a is string => Boolean(a))
      .map((a) => keyringGate(a)()),
  );
}

/**
 * Deletes an account from both the current and pre-rename keyring
 * services. Clearing only the new service used to let a still-present
 * legacy key get RE-IMPORTED by the next migration attempt (or the next
 * app restart, which resets the in-memory gate map) — resurrecting a key
 * the user had just cleared.
 */
async function clearBothKeyringServices(account: string): Promise<void> {
  await Promise.allSettled([
    invoke("secrets_delete", { service: KEYRING_SERVICE, account }),
    invoke("secrets_delete", { service: LEGACY_KEYRING_SERVICE, account }),
  ]);
}

export async function getKey(provider: ProviderId): Promise<string | null> {
  if (!providerSupportsKey(provider)) return null;
  await ensureKeyringMigrated([getProvider(provider).keyringAccount]);
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: getProvider(provider).keyringAccount,
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setKey(provider: ProviderId, key: string): Promise<void> {
  if (!providerSupportsKey(provider)) {
    throw new Error(`${provider} does not use an API key`);
  }
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  const account = getProvider(provider).keyringAccount;
  await ensureKeyringMigrated([account]);
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account,
    password: trimmed,
  });
}

export async function clearKey(provider: ProviderId): Promise<void> {
  if (!providerSupportsKey(provider)) return;
  const account = getProvider(provider).keyringAccount;
  await ensureKeyringMigrated([account]);
  await clearBothKeyringServices(account);
}

export async function getAllKeys(): Promise<ProviderKeys> {
  const out = { ...EMPTY_PROVIDER_KEYS };
  const need = PROVIDERS.filter((p) => providerSupportsKey(p.id));
  await ensureKeyringMigrated(need.map((p) => p.keyringAccount));
  try {
    const results = await invoke<(string | null)[]>("secrets_get_all", {
      service: KEYRING_SERVICE,
      accounts: need.map((p) => p.keyringAccount),
    });
    need.forEach((p, i) => {
      const v = results[i];
      out[p.id] = v && v.length > 0 ? v : null;
    });
    return out;
  } catch {
    const entries = await Promise.all(
      need.map(async (p) => [p.id, await getKey(p.id)] as const),
    );
    for (const [id, v] of entries) out[id] = v;
    return out;
  }
}

export function hasAnyKey(keys: ProviderKeys): boolean {
  return PROVIDERS.some((p) => providerSupportsKey(p.id) && !!keys[p.id]);
}

function compatKeyringAccount(endpointId: string): string {
  return `compat-${endpointId}-api-key`;
}

export async function getCustomEndpointKey(
  endpointId: string,
): Promise<string | null> {
  await ensureKeyringMigrated([compatKeyringAccount(endpointId)]);
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: compatKeyringAccount(endpointId),
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setCustomEndpointKey(
  endpointId: string,
  key: string,
): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  const account = compatKeyringAccount(endpointId);
  await ensureKeyringMigrated([account]);
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account,
    password: trimmed,
  });
}

export async function clearCustomEndpointKey(
  endpointId: string,
): Promise<void> {
  const account = compatKeyringAccount(endpointId);
  await ensureKeyringMigrated([account]);
  await clearBothKeyringServices(account);
}

export async function getAllCustomEndpointKeys(
  endpoints: readonly CustomEndpoint[],
): Promise<CustomEndpointKeys> {
  if (endpoints.length === 0) return {};
  const out: CustomEndpointKeys = {};
  const accountsForMigration = endpoints.map((e) => compatKeyringAccount(e.id));
  await ensureKeyringMigrated(accountsForMigration);
  try {
    const accounts = accountsForMigration;
    const results = await invoke<(string | null)[]>("secrets_get_all", {
      service: KEYRING_SERVICE,
      accounts,
    });
    endpoints.forEach((e, i) => {
      const v = results[i];
      out[e.id] = v && v.length > 0 ? v : null;
    });
  } catch {
    for (const e of endpoints) {
      out[e.id] = await getCustomEndpointKey(e.id);
    }
  }
  return out;
}
