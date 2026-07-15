import { LazyStore } from "@tauri-apps/plugin-store";

// Non-secret fleet settings (the daemon base URL) persist in the module's own Tauri store,
// so the fleet module stays self-contained and doesn't touch the shared preferences schema.
// The daemon TOKEN is a secret and lives in the keyring instead (see fleetKeyring.ts).
const STORE_PATH = "glance-fleet.json";
const KEY_BASE_URL = "daemonBaseUrl";

export const DEFAULT_DAEMON_URL = "http://127.0.0.1:7878";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function getDaemonUrl(): Promise<string> {
  const v = await store.get<string>(KEY_BASE_URL);
  return v && v.length > 0 ? v : DEFAULT_DAEMON_URL;
}

export async function setDaemonUrl(url: string): Promise<void> {
  await store.set(KEY_BASE_URL, url);
}
