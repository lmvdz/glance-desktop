import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { FleetLayout } from "@/modules/fleet/spine/FleetLayout";
import { useFleetConnection } from "@/modules/fleet/store/fleetConnectionStore";
import { useEffect } from "react";

/**
 * The DEFAULT shell (hub-shell concern H0): t3code's two-pane thread client as
 * the app's root, NOT an editor tab inside terax's IDE frame. See DIRECTION.md —
 * the thread client is the whole app; terax's IDE is the on-demand substrate
 * ("workspace" mode).
 *
 * HubShell is minimal chrome. It owns:
 *  - the window frame the hub has no Header for: a slim drag-region titlebar
 *    that hosts the custom WindowControls on Linux/Windows and leaves room for
 *    macOS's native overlay traffic lights;
 *  - the fleet connection lifecycle (moved here from the retired FleetPane):
 *    init once on mount, re-probe whenever the hub becomes visible again (the
 *    daemon may have come up, or the token changed in Settings, while the IDE
 *    mode was showing).
 *
 * The body is `FleetLayout` — the always-two-pane spine+detail scaffold that
 * already paints the t3 silhouette in every connection state.
 */
export function HubShell({ visible }: { visible: boolean }) {
  const hydrated = useFleetConnection((s) => s.hydrated);
  const init = useFleetConnection((s) => s.init);
  const refresh = useFleetConnection((s) => s.refresh);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (visible && hydrated) void refresh();
  }, [visible, hydrated, refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <HubTitlebar />
      <div className="min-h-0 flex-1">
        <FleetLayout />
      </div>
    </div>
  );
}

/**
 * The hub's window-frame strip. It carries no content beyond the wordmark and
 * the window controls — the real rail chrome (search, settings) lives inside
 * FleetLayout's spine (concern H1). Its whole job is drag + traffic-light /
 * window-control parity across platforms:
 *  - macOS: `titleBarStyle: "Overlay"` floats native traffic lights over the
 *    top-left, so we render no custom controls and pad the left (`pl-20`) to
 *    clear them; the whole strip is a drag region.
 *  - Linux/Windows: no native controls, so we render our own `WindowControls`
 *    at the right and keep the rest of the strip draggable.
 */
function HubTitlebar() {
  return (
    <div
      data-tauri-drag-region
      className={`flex h-10 shrink-0 items-center border-b border-border/60 bg-card select-none ${
        IS_MAC ? "pl-20 pr-3" : "pl-3 pr-0"
      }`}
    >
      <span
        data-tauri-drag-region
        className="text-[13px] font-semibold tracking-tight text-foreground/90"
      >
        glance
      </span>
      <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      {USE_CUSTOM_WINDOW_CONTROLS && <WindowControls />}
    </div>
  );
}
