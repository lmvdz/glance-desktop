import { create } from "zustand";
import {
  FleetClient,
  type FleetHealth,
  normalizeBaseUrl,
} from "../lib/fleetClient";
import {
  type DaemonConnection,
  addConnection as addConnectionConfig,
  getActiveDaemonId,
  getConnections,
  removeConnection as removeConnectionConfig,
  setActiveDaemonId,
  setDaemonUrl,
  updateConnection as updateConnectionConfig,
} from "../lib/fleetConfig";
import {
  getDaemonToken,
  setDaemonToken as setDaemonTokenKeyring,
} from "../lib/fleetKeyring";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "unauthorized"
  | "unreachable";

export type DaemonStatusEntry = {
  status: ConnectionStatus;
  detail: string;
};

type FleetConnectionState = {
  /** All configured daemons (M01). */
  connections: DaemonConnection[];
  /** The currently-active daemon's id, or null before hydration / with zero connections. */
  activeId: string | null;
  /** Per-daemon connection status, keyed by connection id. */
  statuses: Record<string, DaemonStatusEntry>;
  hydrated: boolean;

  /** Back-compat mirrors of the ACTIVE daemon — every pre-M01 consumer reads these. */
  baseUrl: string;
  status: ConnectionStatus;
  detail: string;

  /** Load persisted connections + active id, then probe the active one. Idempotent per window. */
  init: () => Promise<void>;
  /** Back-compat: persist a new base URL for the ACTIVE daemon and re-probe it. */
  setBaseUrl: (raw: string) => Promise<void>;
  /** Re-probe one daemon (default: the active one). */
  refresh: (id?: string) => Promise<void>;
  /** A client bound to the given (or active) daemon's URL + latest keyring token. */
  client: (id?: string) => Promise<FleetClient>;

  /** Switch the active daemon and probe it. */
  setActive: (id: string) => Promise<void>;
  /** Add a new daemon connection (+ optional token), probe it, and return it. */
  addDaemon: (input: {
    label: string;
    baseUrl: string;
    token?: string;
  }) => Promise<DaemonConnection>;
  /** Edit a connection's label/URL and re-probe it. */
  updateDaemon: (
    id: string,
    patch: Partial<Pick<DaemonConnection, "label" | "baseUrl">>,
  ) => Promise<void>;
  /** Remove a connection. If it was active, another connection (or none) becomes active. */
  removeDaemon: (id: string) => Promise<void>;
};

let initPromise: Promise<void> | null = null;

/** Pure: derive the active-daemon mirror fields from a state snapshot (never from a stale `get()`). */
function deriveMirror(state: {
  connections: DaemonConnection[];
  activeId: string | null;
  statuses: Record<string, DaemonStatusEntry>;
}): Pick<FleetConnectionState, "baseUrl" | "status" | "detail"> {
  const active = state.connections.find((c) => c.id === state.activeId);
  const entry = state.activeId ? state.statuses[state.activeId] : undefined;
  return {
    baseUrl: active ? normalizeBaseUrl(active.baseUrl) : "",
    status: entry?.status ?? "idle",
    detail: entry?.detail ?? "",
  };
}

export const useFleetConnection = create<FleetConnectionState>((set, get) => ({
  connections: [],
  activeId: null,
  statuses: {},
  hydrated: false,

  baseUrl: "",
  status: "idle",
  detail: "",

  client: async (id?: string) => {
    const targetId = id ?? get().activeId;
    const conn = get().connections.find((c) => c.id === targetId);
    const baseUrl = conn ? normalizeBaseUrl(conn.baseUrl) : "";
    const token = targetId ? await getDaemonToken(targetId) : null;
    return new FleetClient({ baseUrl, token });
  },

  refresh: async (id?: string) => {
    const targetId = id ?? get().activeId;
    if (!targetId) return;
    const conn = get().connections.find((c) => c.id === targetId);
    if (!conn) return;

    set((s) => {
      const statuses = {
        ...s.statuses,
        [targetId]: { status: "connecting" as ConnectionStatus, detail: "probing…" },
      };
      return { statuses, ...deriveMirror({ ...s, statuses }) };
    });

    const client = await get().client(targetId);
    const h: FleetHealth = await client.health();

    set((s) => {
      const statuses = {
        ...s.statuses,
        [targetId]: { status: h.status, detail: h.detail },
      };
      return { statuses, ...deriveMirror({ ...s, statuses }) };
    });
  },

  setBaseUrl: async (raw: string) => {
    const baseUrl = normalizeBaseUrl(raw);
    const activeId = get().activeId;
    if (!activeId) return;
    await setDaemonUrl(baseUrl);
    set((s) => {
      const connections = s.connections.map((c) =>
        c.id === activeId ? { ...c, baseUrl } : c,
      );
      return { connections, ...deriveMirror({ ...s, connections }) };
    });
    await get().refresh(activeId);
  },

  init: () => {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const [connections, activeId] = await Promise.all([
        getConnections(),
        getActiveDaemonId(),
      ]);
      set((s) => ({
        connections,
        activeId,
        hydrated: true,
        ...deriveMirror({ ...s, connections, activeId }),
      }));
      // Probe the active daemon first (it drives the cockpit's connected/not view today),
      // then the rest so their statuses are ready once M02 starts reading them.
      if (activeId) await get().refresh(activeId);
      await Promise.all(
        connections
          .filter((c) => c.id !== activeId)
          .map((c) => get().refresh(c.id)),
      );
    })();
    return initPromise;
  },

  setActive: async (id: string) => {
    await setActiveDaemonId(id);
    set((s) => ({ activeId: id, ...deriveMirror({ ...s, activeId: id }) }));
    await get().refresh(id);
  },

  addDaemon: async ({ label, baseUrl, token }) => {
    const conn = await addConnectionConfig({
      label,
      baseUrl: normalizeBaseUrl(baseUrl),
    });
    if (token?.trim()) await setDaemonTokenKeyring(conn.id, token);
    set((s) => {
      const connections = [...s.connections, conn];
      return { connections, ...deriveMirror({ ...s, connections }) };
    });
    await get().refresh(conn.id);
    return conn;
  },

  updateDaemon: async (id, patch) => {
    const normalizedPatch =
      patch.baseUrl !== undefined
        ? { ...patch, baseUrl: normalizeBaseUrl(patch.baseUrl) }
        : patch;
    await updateConnectionConfig(id, normalizedPatch);
    set((s) => {
      const connections = s.connections.map((c) =>
        c.id === id ? { ...c, ...normalizedPatch } : c,
      );
      return { connections, ...deriveMirror({ ...s, connections }) };
    });
    await get().refresh(id);
  },

  removeDaemon: async (id: string) => {
    await removeConnectionConfig(id);
    const wasActive = get().activeId === id;
    set((s) => {
      const connections = s.connections.filter((c) => c.id !== id);
      const statuses = { ...s.statuses };
      delete statuses[id];
      const activeId = wasActive ? (connections[0]?.id ?? null) : s.activeId;
      return {
        connections,
        statuses,
        activeId,
        ...deriveMirror({ connections, activeId, statuses }),
      };
    });
    const nextActive = get().activeId;
    if (wasActive && nextActive) await get().refresh(nextActive);
  },
}));
