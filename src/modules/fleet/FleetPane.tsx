import { useEffect } from "react";
import { FleetLayout } from "./spine/FleetLayout";
import { useFleetConnection } from "./store/fleetConnectionStore";

// C13-F2: the fleet surface is ALWAYS the two-column FleetLayout scaffold (spine-left,
// detail-right) — connection state is expressed WITHIN it (skeleton spine + connecting
// detail while probing; spine chrome + a recovery card when idle/rejected/unreachable;
// live spine + intervene when connected), never as a full-pane modal that hides the t3
// silhouette. This pane owns only the connection lifecycle for the surface.

export function FleetPane({ visible }: { visible: boolean }) {
  const hydrated = useFleetConnection((s) => s.hydrated);
  const init = useFleetConnection((s) => s.init);
  const refresh = useFleetConnection((s) => s.refresh);

  useEffect(() => {
    void init();
  }, [init]);

  // Re-probe when this pane becomes visible again — the daemon may have come up, or the
  // token may have changed in Settings while we were backgrounded.
  useEffect(() => {
    if (visible && hydrated) void refresh();
  }, [visible, hydrated, refresh]);

  return <FleetLayout />;
}
