// The always-visible thread spine + adjacent detail pane (t3-face concern 05 — see
// plans/t3-face/05-thread-spine.md). Replaces the old RosterView `if (selected) return
// <IntervenePane…>` modal drill-down: the list (ThreadSpine) never unmounts when the selection
// changes; only the right-hand detail side swaps between IntervenePane and the empty state.
//
// C13-F2 (cockpit-first launch): this layout is now the CONSTANT scaffold for the fleet surface
// in every connection state, not just `connected`. The t3 silhouette (list-left, detail-right)
// paints from the first frame — a cold/rejected/unreachable daemon reads as a spine with a quiet
// status and a recovery card in the detail slot, never a full-pane modal that hides the shape.

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
import { HubHero } from "../HubHero";
import { IntervenePane } from "../IntervenePane";
import { FleetEmpty } from "../EmptyState";
import { canOpenUnitWorktree } from "../lib/worktreeOpener";
import { unitKey } from "../lib/fleetRoster";
import {
  type ConnectionStatus,
  useFleetConnection,
} from "../store/fleetConnectionStore";
import { useFleetRoster } from "../store/fleetRosterStore";
import { useFleetSelection } from "../store/fleetSelectionStore";
import { SpineHeader, SpineSkeleton } from "./SpineChrome";
import { ThreadSpine } from "./ThreadSpine";

/** Every state the spine scaffold covers on its own — i.e. not `connected`. */
type PendingStatus = Exclude<ConnectionStatus, "connected">;
/** The states with a full recovery card (idle/rejected/unreachable) — `connecting`
 *  is a momentary probe and gets a spinner, not a card. */
type OfflineStatus = Exclude<PendingStatus, "connecting">;

/** Compact right-aligned status shown in the spine header before we're connected. */
const SPINE_STATUS: Record<PendingStatus, { text: string; cls: string }> = {
  connecting: { text: "connecting…", cls: "text-muted-foreground/70" },
  idle: { text: "not connected", cls: "text-muted-foreground/70" },
  unauthorized: { text: "unauthorized", cls: "text-warning" },
  unreachable: { text: "unreachable", cls: "text-warning" },
};

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

/** Left column before we're connected: the spine's own header chrome + a quiet body
 *  (skeleton sweep while probing, empty otherwise — the detail card does the talking). */
function SpineScaffold({ status }: { status: PendingStatus }) {
  const s = SPINE_STATUS[status];
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <SpineHeader
        right={<span className={`text-[11px] ${s.cls}`}>{s.text}</span>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {status === "connecting" && <SpineSkeleton />}
      </div>
    </div>
  );
}

/** Detail column while the active daemon is being probed — quiet, user-side copy. */
function ConnectingDetail() {
  const baseUrl = useFleetConnection((s) => s.baseUrl);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      <HugeiconsIcon icon={Loading03Icon} size={28} className="animate-spin" />
      <div className="text-sm">Connecting to your fleet…</div>
      {baseUrl && (
        <div className="font-mono text-[12px] text-muted-foreground/70">
          {baseUrl}
        </div>
      )}
    </div>
  );
}

/** Detail column when the fleet is unreachable / rejected / not-yet-configured:
 *  the concern-11 layered-card empty state with its recovery actions inline. */
function OfflineDetail({ status }: { status: OfflineStatus }) {
  const baseUrl = useFleetConnection((s) => s.baseUrl);
  const detail = useFleetConnection((s) => s.detail);
  const refresh = useFleetConnection((s) => s.refresh);
  const meta = OFFLINE_META[status];
  return (
    <div className="flex h-full w-full items-center justify-center">
      <FleetEmpty
        icon={meta.icon}
        title={meta.title}
        description={meta.description}
      >
        <div className="text-center">
          <div className="font-mono text-[12px] text-foreground">
            {baseUrl || "No daemon address set yet"}
          </div>
          {detail && (
            <div className="mt-1 text-[12px] text-muted-foreground">
              {detail}
            </div>
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

// No selection → the hub hero (r3 borrow 6): "What should we build?" + a composer that starts a
// thread on the active daemon — the on-ramp gesture, not a passive "Select a unit" card.

export function FleetLayout() {
  const status = useFleetConnection((s) => s.status);
  const units = useFleetRoster((s) => s.units);
  const connections = useFleetConnection((s) => s.connections);
  const selectedId = useFleetSelection((s) => s.selectedId);
  const select = useFleetSelection((s) => s.select);

  const selected = selectedId
    ? units.find((u) => unitKey(u) === selectedId)
    : undefined;

  // A selected unit that vanishes from the roster (landed/removed) drops back to the empty detail
  // state once the roster has actually loaded — ported unchanged from RosterView's own effect.
  useEffect(() => {
    if (selectedId && !selected && units.length > 0) select(null);
  }, [selectedId, selected, units.length, select]);

  // Mark-seen on focus (t3-face concern 07, step 6): opening a unit writes `lastVisitedAt` to its
  // OWN daemon, so a `completed-unseen` rung resolves to `idle` on the next poll — for THIS viewer
  // and any second client. The write lives on the daemon (concern 06's per-viewer seen store), never
  // a local store. Fire-and-forget; keyed on the unit's identity (not the polled object) so it fires
  // once per selection change, not every ~2s roster poll. `selectedUnitId`/`selectedDaemonId` are
  // read here rather than closing over `selected` so the effect's deps stay primitive + stable.
  const selectedUnitId = selected?.id;
  const selectedDaemonId = selected?.daemonId;
  useEffect(() => {
    if (!selectedUnitId || !selectedDaemonId) return;
    void useFleetConnection
      .getState()
      .client(selectedDaemonId)
      .then((c) => c.markUnitSeen(selectedUnitId))
      .catch(() => {});
  }, [selectedUnitId, selectedDaemonId]);

  // `pending` narrows to the non-connected statuses so the scaffold pieces stay typed.
  const pending: PendingStatus | null =
    status === "connected" ? null : status;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="w-64 shrink-0 border-r border-border/60 sm:w-72">
        {pending ? <SpineScaffold status={pending} /> : <ThreadSpine />}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        {pending ? (
          pending === "connecting" ? (
            <ConnectingDetail />
          ) : (
            <OfflineDetail status={pending} />
          )
        ) : selected ? (
          <IntervenePane
            unit={selected}
            canOpen={canOpenUnitWorktree(connections, selected.daemonId)}
            onBack={() => select(null)}
          />
        ) : (
          <HubHero />
        )}
      </div>
    </div>
  );
}
