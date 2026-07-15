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
import {
  type ConnectionStatus,
  useFleetConnection,
} from "./store/fleetConnectionStore";

// C04 skeleton: this pane shows ONLY the daemon connection state. The live roster and
// attention queue render here in C05, once the connection layer below is trusted.

const STATUS_META: Record<
  ConnectionStatus,
  { label: string; icon: typeof ServerStack01Icon; cls: string; spin?: boolean }
> = {
  idle: {
    label: "Not connected",
    icon: ServerStack01Icon,
    cls: "text-gray-500 dark:text-gray-400",
  },
  connecting: {
    label: "Connecting…",
    icon: Loading03Icon,
    cls: "text-gray-500 dark:text-gray-400",
    spin: true,
  },
  connected: {
    label: "Connected",
    icon: CheckmarkCircle02Icon,
    cls: "text-emerald-600 dark:text-emerald-400",
  },
  unauthorized: {
    label: "Unauthorized",
    icon: Alert02Icon,
    cls: "text-amber-600 dark:text-amber-400",
  },
  unreachable: {
    label: "Unreachable",
    icon: Alert02Icon,
    cls: "text-red-600 dark:text-red-400",
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

      <div className="max-w-md text-sm text-gray-600 dark:text-gray-300">
        <div className="font-mono text-[13px] text-gray-800 dark:text-gray-200">
          {baseUrl || "no daemon URL set"}
        </div>
        {detail && (
          <div className="mt-1 text-gray-500 dark:text-gray-400">{detail}</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={status === "connecting"}
          className="flex min-h-8 items-center gap-1.5 rounded-md border border-gray-200 px-3 text-sm text-gray-700 transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <HugeiconsIcon icon={Refresh01Icon} size={15} />
          Retry
        </button>
        <button
          type="button"
          onClick={() => void openSettingsWindow("fleet")}
          className="flex min-h-8 items-center gap-1.5 rounded-md border border-gray-200 px-3 text-sm text-gray-700 transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <HugeiconsIcon icon={Settings01Icon} size={15} />
          Fleet settings
        </button>
      </div>

      {status === "connected" && (
        <div className="text-xs text-gray-400 dark:text-gray-500">
          The roster lands here next (C05).
        </div>
      )}
    </div>
  );
}
