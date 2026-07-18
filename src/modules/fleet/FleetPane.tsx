import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  Refresh01Icon,
  ServerStack01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { FleetLayout } from "./spine/FleetLayout";
import {
  type ConnectionStatus,
  useFleetConnection,
} from "./store/fleetConnectionStore";

// C04 skeleton: this pane shows ONLY the daemon connection state. The always-visible thread
// spine (C05) — units + adoptable sessions grouped by project/daemon, detail pane adjacent —
// takes over once the connection layer below is trusted.

const STATUS_META: Record<
  ConnectionStatus,
  { label: string; icon: typeof ServerStack01Icon; cls: string; spin?: boolean }
> = {
  idle: {
    label: "Not connected",
    icon: ServerStack01Icon,
    cls: "text-muted-foreground",
  },
  connecting: {
    label: "Connecting…",
    icon: Loading03Icon,
    cls: "text-muted-foreground",
    spin: true,
  },
  connected: {
    label: "Connected",
    icon: CheckmarkCircle02Icon,
    cls: "text-success-foreground",
  },
  unauthorized: {
    label: "Unauthorized",
    icon: Alert02Icon,
    cls: "text-warning-foreground",
  },
  unreachable: {
    label: "Unreachable",
    icon: Alert02Icon,
    cls: "text-destructive",
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

  // Connected → the thread spine (C05) takes over the pane. Every other state keeps the
  // centered connection view below so the operator can see why there's no fleet yet.
  if (status === "connected") return <FleetLayout />;

  const meta = STATUS_META[status];

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 p-8 text-center">
      <div className={`flex flex-col items-center gap-3 ${meta.cls}`}>
        <HugeiconsIcon
          icon={meta.icon}
          size={40}
          className={meta.spin ? "animate-spin" : undefined}
        />
        <div className="text-lg font-medium">{meta.label}</div>
      </div>

      <div className="max-w-md text-sm text-muted-foreground">
        <div className="font-mono text-[13px] text-foreground">
          {baseUrl || "no daemon URL set"}
        </div>
        {detail && <div className="mt-1 text-muted-foreground">{detail}</div>}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={status === "connecting"}
          className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-3 text-sm text-foreground/85 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <HugeiconsIcon icon={Refresh01Icon} size={15} />
          Retry
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
    </div>
  );
}
