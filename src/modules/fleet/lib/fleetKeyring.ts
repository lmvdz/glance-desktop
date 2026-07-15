import { invoke } from "@tauri-apps/api/core";
import { getActiveDaemonId } from "./fleetConfig";

// Fleet daemon bearer tokens live in the OS keychain (same secrets seam the AI providers
// use), never in plaintext preferences. Self-contained service string so the fleet module
// stays decoupled from the AI module. Tokens are keyed per-daemon-connection-id so each
// entry in the M01 connections list keeps its own credential.
const FLEET_KEYRING_SERVICE = "glance-desktop-fleet";

/** Legacy single-daemon account (pre-M01, no id suffix). Read once for migration. */
const LEGACY_TOKEN_ACCOUNT = "fleet-daemon-token";

function tokenAccount(id: string): string {
  return `fleet-daemon-token:${id}`;
}

async function getLegacyToken(): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: FLEET_KEYRING_SERVICE,
      account: LEGACY_TOKEN_ACCOUNT,
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

async function clearLegacyToken(): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: FLEET_KEYRING_SERVICE,
      account: LEGACY_TOKEN_ACCOUNT,
    });
  } catch {
    // already absent — fine
  }
}

/** Runs once per session: adopt the legacy unscoped token for the active daemon, if any. */
let legacyMigrationAttempted = false;

async function migrateLegacyTokenInto(id: string): Promise<string | null> {
  if (legacyMigrationAttempted) return null;

  // Only the ACTIVE daemon adopts the legacy unscoped token. Crucially, don't consume the
  // one-shot flag for a non-active daemon's lookup — otherwise a probe of a second daemon that
  // happened to run first would burn the attempt and orphan the active daemon's saved token.
  const activeId = await getActiveDaemonId();
  if (activeId !== id) return null;
  legacyMigrationAttempted = true;

  const legacy = await getLegacyToken();
  if (!legacy) return null;

  await setDaemonToken(id, legacy);
  await clearLegacyToken();
  return legacy;
}

export async function getDaemonToken(id: string): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: FLEET_KEYRING_SERVICE,
      account: tokenAccount(id),
    });
    if (v && v.length > 0) return v;
  } catch {
    // fall through — treat a keyring error the same as "not found"
  }

  return migrateLegacyTokenInto(id);
}

export async function setDaemonToken(id: string, token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    await clearDaemonToken(id);
    return;
  }
  await invoke("secrets_set", {
    service: FLEET_KEYRING_SERVICE,
    account: tokenAccount(id),
    password: trimmed,
  });
}

export async function clearDaemonToken(id: string): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: FLEET_KEYRING_SERVICE,
      account: tokenAccount(id),
    });
  } catch {
    // already absent — fine
  }
}

// ---------------------------------------------------------------------------------------
// Back-compat single-daemon API — every pre-M01 consumer keeps working by following
// "the active daemon"'s token instead of one fixed keyring entry.
// ---------------------------------------------------------------------------------------

export async function getFleetToken(): Promise<string | null> {
  const activeId = await getActiveDaemonId();
  if (!activeId) return null;
  return getDaemonToken(activeId);
}

export async function setFleetToken(token: string): Promise<void> {
  const activeId = await getActiveDaemonId();
  if (!activeId) return;
  await setDaemonToken(activeId, token);
}

export async function clearFleetToken(): Promise<void> {
  const activeId = await getActiveDaemonId();
  if (!activeId) return;
  await clearDaemonToken(activeId);
}
