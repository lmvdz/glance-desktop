import { create } from "zustand";
import {
  FleetClient,
  type FleetHealth,
  normalizeBaseUrl,
} from "../lib/fleetClient";
import { getDaemonUrl, setDaemonUrl } from "../lib/fleetConfig";
import { getFleetToken } from "../lib/fleetKeyring";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "unauthorized"
  | "unreachable";

type FleetConnectionState = {
  baseUrl: string;
  status: ConnectionStatus;
  detail: string;
  hydrated: boolean;
  /** Load persisted URL + keyring token, then probe once. Idempotent per window. */
  init: () => Promise<void>;
  /** Persist a new base URL and re-probe. */
  setBaseUrl: (raw: string) => Promise<void>;
  /** Re-read the token (it may have changed in Settings) and probe. */
  refresh: () => Promise<void>;
  /** A client bound to the current URL + latest keyring token, for callers (C05 roster). */
  client: () => Promise<FleetClient>;
};

let initPromise: Promise<void> | null = null;

function applyHealth(
  set: (p: Partial<FleetConnectionState>) => void,
  h: FleetHealth,
): void {
  set({ status: h.status, detail: h.detail });
}

export const useFleetConnection = create<FleetConnectionState>((set, get) => ({
  baseUrl: "",
  status: "idle",
  detail: "",
  hydrated: false,

  client: async () => {
    const token = await getFleetToken();
    return new FleetClient({ baseUrl: get().baseUrl, token });
  },

  refresh: async () => {
    if (!get().baseUrl) return;
    set({ status: "connecting", detail: "probing…" });
    const client = await get().client();
    applyHealth(set, await client.health());
  },

  setBaseUrl: async (raw: string) => {
    const baseUrl = normalizeBaseUrl(raw);
    set({ baseUrl });
    await setDaemonUrl(baseUrl);
    await get().refresh();
  },

  init: () => {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const baseUrl = normalizeBaseUrl(await getDaemonUrl());
      set({ baseUrl, hydrated: true });
      await get().refresh();
    })();
    return initPromise;
  },
}));
