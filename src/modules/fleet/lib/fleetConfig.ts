import { LazyStore } from "@tauri-apps/plugin-store";

// Non-secret fleet settings (the daemon connections list) persist in the module's own
// Tauri store, so the fleet module stays self-contained and doesn't touch the shared
// preferences schema. Daemon TOKENS are secrets and live in the keyring instead
// (see fleetKeyring.ts), keyed per-connection id.
const STORE_PATH = "glance-fleet.json";

/** Legacy single-daemon scalar (pre-M01). Read once for migration, never written again. */
const KEY_BASE_URL = "daemonBaseUrl";

const KEY_CONNECTIONS = "daemonConnections";
const KEY_ACTIVE = "activeDaemonId";

export const DEFAULT_DAEMON_URL = "http://127.0.0.1:7878";

export interface DaemonConnection {
  id: string;
  label: string;
  baseUrl: string;
}

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

// ---------------------------------------------------------------------------------------
// Pure logic (unit-tested in fleetConfig.test.ts) — no Tauri-store IO in these functions.
// ---------------------------------------------------------------------------------------

export interface MigrateConnectionsInput {
  /** The legacy scalar `daemonBaseUrl`, if the store still has one (pre-M01 installs). */
  legacyUrl?: string | null;
  /** Whatever the store already has under `daemonConnections`, if anything. */
  existingConnections?: DaemonConnection[] | null;
  /** Whatever the store already has under `activeDaemonId`, if anything. */
  existingActiveId?: string | null;
  /** Id generator, injected so the function stays pure/deterministic in tests. */
  newId: () => string;
}

export interface MigrateConnectionsResult {
  connections: DaemonConnection[];
  activeId: string;
  /** True when the caller must persist `connections`/`activeId` (something changed or was seeded). */
  dirty: boolean;
}

/**
 * Decide the connections list + active id the store should hold, given whatever it already
 * has (or doesn't). Three cases, in priority order:
 *   1. A connections list already exists — keep it, just make sure `activeId` points at a
 *      real entry (falls back to the first connection if it's missing/stale).
 *   2. No list yet, but the legacy single `daemonBaseUrl` scalar is set — migrate it into a
 *      one-element list so the user's configured daemon is never orphaned.
 *   3. Neither exists (fresh install) — seed a default local connection.
 */
export function migrateConnections(
  input: MigrateConnectionsInput,
): MigrateConnectionsResult {
  const { legacyUrl, existingConnections, existingActiveId, newId } = input;

  if (existingConnections && existingConnections.length > 0) {
    const activeId =
      existingActiveId &&
      existingConnections.some((c) => c.id === existingActiveId)
        ? existingActiveId
        : existingConnections[0].id;
    return {
      connections: existingConnections,
      activeId,
      dirty: activeId !== existingActiveId,
    };
  }

  if (legacyUrl && legacyUrl.length > 0) {
    const id = newId();
    return {
      connections: [{ id, label: "Local daemon", baseUrl: legacyUrl }],
      activeId: id,
      dirty: true,
    };
  }

  const id = newId();
  return {
    connections: [{ id, label: "Local daemon", baseUrl: DEFAULT_DAEMON_URL }],
    activeId: id,
    dirty: true,
  };
}

/**
 * After removing a connection that was active, pick the next active one — the first of
 * whatever remains, or null when the list is now empty.
 */
export function pickNextActive(
  remaining: readonly DaemonConnection[],
): string | null {
  return remaining.length > 0 ? remaining[0].id : null;
}

// ---------------------------------------------------------------------------------------
// Tauri-store IO
// ---------------------------------------------------------------------------------------

let migratedPromise: Promise<void> | null = null;

/** Idempotent, memoized: runs the migration decision once per session and persists it. */
function ensureMigrated(): Promise<void> {
  if (!migratedPromise) {
    migratedPromise = (async () => {
      const existingConnections =
        (await store.get<DaemonConnection[]>(KEY_CONNECTIONS)) ?? null;
      const existingActiveId = (await store.get<string>(KEY_ACTIVE)) ?? null;
      const legacyUrl = existingConnections
        ? null
        : ((await store.get<string>(KEY_BASE_URL)) ?? null);

      const result = migrateConnections({
        legacyUrl,
        existingConnections,
        existingActiveId,
        newId: () => crypto.randomUUID(),
      });

      if (result.dirty) {
        await store.set(KEY_CONNECTIONS, result.connections);
        await store.set(KEY_ACTIVE, result.activeId);
      }
    })();
  }
  return migratedPromise;
}

export async function getConnections(): Promise<DaemonConnection[]> {
  await ensureMigrated();
  return (await store.get<DaemonConnection[]>(KEY_CONNECTIONS)) ?? [];
}

export async function getActiveDaemonId(): Promise<string | null> {
  await ensureMigrated();
  return (await store.get<string>(KEY_ACTIVE)) ?? null;
}

export async function getActiveConnection(): Promise<DaemonConnection | null> {
  const [connections, activeId] = await Promise.all([
    getConnections(),
    getActiveDaemonId(),
  ]);
  return connections.find((c) => c.id === activeId) ?? connections[0] ?? null;
}

export async function addConnection(input: {
  label: string;
  baseUrl: string;
}): Promise<DaemonConnection> {
  const connections = await getConnections();
  const conn: DaemonConnection = {
    id: crypto.randomUUID(),
    label: input.label,
    baseUrl: input.baseUrl,
  };
  await store.set(KEY_CONNECTIONS, [...connections, conn]);
  return conn;
}

export async function updateConnection(
  id: string,
  patch: Partial<Pick<DaemonConnection, "label" | "baseUrl">>,
): Promise<void> {
  const connections = await getConnections();
  const next = connections.map((c) => (c.id === id ? { ...c, ...patch } : c));
  await store.set(KEY_CONNECTIONS, next);
}

export async function removeConnection(id: string): Promise<void> {
  const [connections, activeId] = await Promise.all([
    getConnections(),
    getActiveDaemonId(),
  ]);
  const next = connections.filter((c) => c.id !== id);
  await store.set(KEY_CONNECTIONS, next);
  if (activeId === id) {
    const nextActive = pickNextActive(next);
    if (nextActive) await store.set(KEY_ACTIVE, nextActive);
    else await store.set(KEY_ACTIVE, null);
  }
}

export async function setActiveDaemonId(id: string): Promise<void> {
  await store.set(KEY_ACTIVE, id);
}

// ---------------------------------------------------------------------------------------
// Back-compat single-daemon API — every pre-M01 consumer keeps working by following
// "the active daemon" instead of a fixed scalar.
// ---------------------------------------------------------------------------------------

export async function getDaemonUrl(): Promise<string> {
  const active = await getActiveConnection();
  return active && active.baseUrl.length > 0 ? active.baseUrl : DEFAULT_DAEMON_URL;
}

export async function setDaemonUrl(url: string): Promise<void> {
  const activeId = await getActiveDaemonId();
  if (!activeId) return;
  await updateConnection(activeId, { baseUrl: url });
}
