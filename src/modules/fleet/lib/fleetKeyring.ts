import { invoke } from "@tauri-apps/api/core";

// The fleet daemon's bearer token lives in the OS keychain (same secrets seam the AI
// providers use), never in plaintext preferences. Self-contained service string so the
// fleet module stays decoupled from the AI module.
const FLEET_KEYRING_SERVICE = "glance-desktop-fleet";
const TOKEN_ACCOUNT = "fleet-daemon-token";

export async function getFleetToken(): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: FLEET_KEYRING_SERVICE,
      account: TOKEN_ACCOUNT,
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setFleetToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    await clearFleetToken();
    return;
  }
  await invoke("secrets_set", {
    service: FLEET_KEYRING_SERVICE,
    account: TOKEN_ACCOUNT,
    password: trimmed,
  });
}

export async function clearFleetToken(): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: FLEET_KEYRING_SERVICE,
      account: TOKEN_ACCOUNT,
    });
  } catch {
    // already absent — fine
  }
}
