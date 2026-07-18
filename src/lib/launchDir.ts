import { invoke } from "@tauri-apps/api/core";

let cached: string | undefined;
let explicitTarget = false;

export async function initLaunchDir(): Promise<void> {
  // `get_launch_dir` is the CLI/Open-With target: an explicit dir arg, or the
  // parent of an explicit file arg (see resolve_launch_target in lib.rs). It is
  // null for a plain launch, where we fall back to the process cwd. Capturing
  // whether it was non-null BEFORE the fallback is the "launched on a target"
  // signal — cockpit-first boot yields to it (App.tsx).
  const explicit = await invoke<string | null>("get_launch_dir").catch(
    () => null,
  );
  explicitTarget = explicit != null;
  const dir =
    explicit ??
    (await invoke<string>("workspace_current_dir").catch(() => null));
  cached = dir ? dir.replace(/\\/g, "/") : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached;
}

/** True when the app was launched on an explicit dir/file target (CLI arg or
 *  OS "Open With"), as opposed to a plain launch. Valid after `initLaunchDir`. */
export function hasExplicitLaunchTarget(): boolean {
  return explicitTarget;
}

/**
 * Drains the files passed via the OS "Open With" action (CLI args on
 * Linux/Windows, macOS open-files event). Drained once so HMR / re-mounts
 * can't replay them. Returns [] when the app wasn't launched with a file.
 */
export async function consumeLaunchFiles(): Promise<string[]> {
  const files = await invoke<string[]>("get_launch_files").catch(() => []);
  return files.map((f) => f.replace(/\\/g, "/"));
}
