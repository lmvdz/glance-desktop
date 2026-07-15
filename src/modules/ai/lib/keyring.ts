import { planKeyValueMigration } from "@/modules/migrations/keyValueMigration";
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
 * thin, best-effort IO shell around it (secrets_get/set/delete are already
 * generic invoke commands keyed by service+account — no Rust change needed).
 */
export async function migrateKeyringAccount(account: string): Promise<void> {
  if (!account) return; // local-only providers (lmstudio/mlx/ollama) have no account
  try {
    const [newValue, oldValue] = await Promise.all([
      invoke<string | null>("secrets_get", {
        service: KEYRING_SERVICE,
        account,
      }).catch(() => null),
      invoke<string | null>("secrets_get", {
        service: LEGACY_KEYRING_SERVICE,
        account,
      }).catch(() => null),
    ]);
    const plan = planKeyValueMigration(
      newValue && newValue.length > 0 ? newValue : null,
      oldValue && oldValue.length > 0 ? oldValue : null,
    );
    if (!plan.shouldWriteNew) return;
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
        /* not fatal — the new service already has the key */
      }
    }
  } catch {
    /* migration is best-effort; never block key reads on it */
  }
}

const migratedAccounts = new Set<string>();

/** Migrates a batch of keyring accounts, each exactly once for the life of
 *  the app (tracked per-account, not per-call) — safe to call redundantly
 *  from multiple entrypoints (static provider keys vs. dynamic custom-
 *  endpoint keys are migrated from different call sites, see `getAllKeys`
 *  and `getAllCustomEndpointKeys`). */
async function ensureKeyringMigrated(accounts: readonly string[]): Promise<void> {
  const pending = accounts.filter((a) => a && !migratedAccounts.has(a));
  for (const a of pending) migratedAccounts.add(a);
  await Promise.all(pending.map((a) => migrateKeyringAccount(a)));
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
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: getProvider(provider).keyringAccount,
    password: trimmed,
  });
}

export async function clearKey(provider: ProviderId): Promise<void> {
  if (!providerSupportsKey(provider)) return;
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: getProvider(provider).keyringAccount,
    });
  } catch {
    // already absent — fine
  }
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
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: compatKeyringAccount(endpointId),
    password: trimmed,
  });
}

export async function clearCustomEndpointKey(
  endpointId: string,
): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: compatKeyringAccount(endpointId),
    });
  } catch {}
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
