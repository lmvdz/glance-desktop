import {
  Loading03Icon,
  LockKeyIcon,
  PlugSocketIcon,
  Refresh01Icon,
  Settings01Icon,
  WifiDisconnected01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { FleetEmpty } from "./EmptyState";
import { FleetLayout } from "./spine/FleetLayout";
import {
  type ConnectionStatus,
  useFleetConnection,
} from "./store/fleetConnectionStore";

// C04 skeleton: this pane shows ONLY the daemon connection state. The always-visible thread
// spine (C05) — units + adoptable sessions grouped by project/daemon, detail pane adjacent —
// takes over once the connection layer below is trusted. A pane the operator actually sits in
// (no daemon / rejected token / unreachable) reads as a layered-card empty state (t3-face C11)
// with the recovery actions inline; `connecting` is a momentary probe, so it stays a light spinner.

type OfflineStatus = Exclude<ConnectionStatus, "connected" | "connecting">;

const OFFLINE_META: Record<
  OfflineStatus,
  {
    icon: React.ComponentProps<typeof HugeiconsIcon>["icon"];
    title: string;
    description: string;
  }
> = {
  idle: {
    icon: PlugSocketIcon,
    title: "Not connected",
    description:
      "Point the cockpit at a running glance daemon to see your fleet.",
  },
  unauthorized: {
    icon: LockKeyIcon,
    title: "This daemon rejected the token",
    description:
      "Update the cockpit's access token in fleet settings, then try again.",
  },
  unreachable: {
    icon: WifiDisconnected01Icon,
    title: "Can't reach the daemon",
    description:
      "Nothing answered at this address. Check the daemon is running, then try again.",
  },
};

export function FleetPane({ visible }: { visible: boolean }) {
  const { baseUrl, status, detail, hydrated, init, refresh } =
    useFleetConnection();

  useEffect(() => {
    void init();
  }, [init]);

  // Re-probe when this pane becomes visible again — the daemon may have come up, or the
  // token may have changed in Settings while we were backgrounded.
  useEffect(() => {
    if (visible && hydrated) void refresh();
  }, [visible, hydrated, refresh]);

  // Connected → the thread spine (C05) takes over the pane.
  if (status === "connected") return <FleetLayout />;

  if (status === "connecting") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <HugeiconsIcon icon={Loading03Icon} size={28} className="animate-spin" />
        <div className="text-sm">Connecting to the daemon…</div>
        {baseUrl && (
          <div className="font-mono text-[12px] text-muted-foreground/70">
            {baseUrl}
          </div>
        )}
      </div>
    );
  }

  const meta = OFFLINE_META[status];

  return (
    <div className="flex h-full w-full items-center justify-center">
      <FleetEmpty icon={meta.icon} title={meta.title} description={meta.description}>
        <div className="text-center">
          <div className="font-mono text-[12px] text-foreground">
            {baseUrl || "No daemon address set yet"}
          </div>
          {detail && (
            <div className="mt-1 text-[12px] text-muted-foreground">{detail}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-3 text-sm text-foreground/85 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={15} />
            Try again
          </button>
          <button
            type="button"
            onClick={() => void openSettingsWindow("fleet")}
            className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-3 text-sm text-foreground/85 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HugeiconsIcon icon={Settings01Icon} size={15} />
            Fleet settings
          </button>
        </div>
      </FleetEmpty>
    </div>
  );
}
