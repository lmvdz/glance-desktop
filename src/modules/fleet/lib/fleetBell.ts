import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { AttentionAlert } from "./fleetAttention";
import { useFleetSelection } from "../store/fleetSelectionStore";

// Native OS notification for a unit that needs a human (C08). Firing is reliable; the
// click→focus deep-link uses the plugin's onAction listener, whose desktop delivery varies by
// OS — so the notification (the "come to you" alert) is the guaranteed part, the click is best-effort.

let permission = false;
let actionRegistered = false;

async function ensurePermission(): Promise<boolean> {
  if (permission) return true;
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  permission = ok;
  return ok;
}

/** Register the click→focus handler exactly once: focus the window and open the unit's detail. */
async function ensureActionListener(): Promise<void> {
  if (actionRegistered) return;
  actionRegistered = true;
  try {
    await onAction((n) => {
      const unitId = (n.extra as { unitId?: string } | undefined)?.unitId;
      void getCurrentWindow()
        .setFocus()
        .catch(() => {});
      if (unitId) useFleetSelection.getState().select(unitId);
    });
  } catch {
    // onAction unsupported on this platform — the notification still fires; only click-routing is lost.
    actionRegistered = false;
  }
}

/** Fire one attention alert. The unit id rides in `extra` so a click can focus that exact unit.
 *  Re-alert suppression is handled upstream by the collapse set in the roster store, so a unit
 *  that stays blocked never fires twice. */
export async function notifyAttention(alert: AttentionAlert): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    await ensureActionListener();
    sendNotification({
      title: alert.title,
      body: alert.body,
      extra: { unitId: alert.unitId },
    });
  } catch (e) {
    console.warn("[glance] fleet notification failed:", e);
  }
}
