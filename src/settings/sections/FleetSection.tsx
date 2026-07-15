import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeBaseUrl } from "@/modules/fleet";
import { DEFAULT_DAEMON_URL } from "@/modules/fleet/lib/fleetConfig";
import {
  clearDaemonToken,
  getDaemonToken,
  setDaemonToken,
} from "@/modules/fleet/lib/fleetKeyring";
import { isLoopbackDaemon } from "@/modules/fleet/lib/worktreeOpener";
import {
  type ConnectionStatus,
  type DaemonStatusEntry,
  useFleetConnection,
} from "@/modules/fleet/store/fleetConnectionStore";
import {
  Add01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "Not tested",
  connecting: "Probing…",
  connected: "Connected",
  unauthorized: "Unauthorized",
  unreachable: "Unreachable",
};

function statusColor(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "text-emerald-500";
    case "unauthorized":
      return "text-amber-500";
    case "unreachable":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
}

export function FleetSection() {
  const connections = useFleetConnection((s) => s.connections);
  const activeId = useFleetConnection((s) => s.activeId);
  const statuses = useFleetConnection((s) => s.statuses);
  const hydrated = useFleetConnection((s) => s.hydrated);
  const init = useFleetConnection((s) => s.init);
  const setActive = useFleetConnection((s) => s.setActive);
  const addDaemon = useFleetConnection((s) => s.addDaemon);
  const updateDaemon = useFleetConnection((s) => s.updateDaemon);
  const removeDaemon = useFleetConnection((s) => s.removeDaemon);
  const refresh = useFleetConnection((s) => s.refresh);

  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  const onAdd = async () => {
    setAdding(true);
    try {
      await addDaemon({ label: "New daemon", baseUrl: DEFAULT_DAEMON_URL });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Fleet daemons"
        description="Connect this cockpit to one or more glance daemons to manage the agent fleet. The active daemon drives the fleet pane. Tokens are stored in your OS keychain, never in plaintext."
      />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
            Daemons
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
            disabled={adding}
            onClick={() => void onAdd()}
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
            Add daemon
          </Button>
        </div>

        {!hydrated ? (
          <div className="text-[12px] text-muted-foreground">Loading…</div>
        ) : connections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-8 text-center">
            <p className="text-[12px] text-muted-foreground">
              No daemons configured.
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
              Click "Add daemon" to connect a local or remote glance daemon.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {connections.map((conn) => (
              <DaemonCard
                key={conn.id}
                id={conn.id}
                label={conn.label}
                baseUrl={conn.baseUrl}
                active={conn.id === activeId}
                statusEntry={statuses[conn.id]}
                onSetActive={() => void setActive(conn.id)}
                onUpdate={(patch) => updateDaemon(conn.id, patch)}
                onRemove={() => void removeDaemon(conn.id)}
                onTest={() => refresh(conn.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DaemonCard({
  id,
  label,
  baseUrl,
  active,
  statusEntry,
  onSetActive,
  onUpdate,
  onRemove,
  onTest,
}: {
  id: string;
  label: string;
  baseUrl: string;
  active: boolean;
  statusEntry?: DaemonStatusEntry;
  onSetActive: () => void;
  onUpdate: (
    patch: Partial<{ label: string; baseUrl: string }>,
  ) => Promise<void>;
  onRemove: () => void;
  onTest: () => Promise<void>;
}) {
  const [labelDraft, setLabelDraft] = useState(label);
  const [urlDraft, setUrlDraft] = useState(baseUrl);
  const [token, setToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => setLabelDraft(label), [label]);
  useEffect(() => setUrlDraft(baseUrl), [baseUrl]);
  useEffect(() => {
    void getDaemonToken(id).then((t) => setTokenSaved(t !== null));
  }, [id]);

  const remote = !isLoopbackDaemon(normalizeBaseUrl(baseUrl));
  const status = statusEntry?.status ?? "idle";
  const detail = statusEntry?.detail ?? "";

  const saveToken = async () => {
    if (token.trim()) {
      await setDaemonToken(id, token);
      setToken("");
      setTokenSaved(true);
    } else {
      await clearDaemonToken(id);
      setTokenSaved(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await onTest();
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Input
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={() => {
            const v = labelDraft.trim();
            if (v && v !== label) void onUpdate({ label: v });
            else setLabelDraft(label);
          }}
          placeholder="Daemon name"
          className="h-7 w-40 text-[12px] font-medium"
        />
        {active ? (
          <Badge
            variant="outline"
            className="h-4 gap-1 border-border/60 bg-muted/40 px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={9}
              strokeWidth={2}
            />
            Active
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={onSetActive}
            className="h-6 px-2 text-[10.5px] text-muted-foreground hover:text-foreground"
          >
            Set active
          </Button>
        )}
        <span className={`ml-auto text-[10.5px] ${statusColor(status)}`}>
          {STATUS_LABEL[status]}
        </span>
        <Button
          size="icon"
          variant="ghost"
          onClick={onRemove}
          title="Remove daemon"
          className="size-7 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <Input
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onBlur={() => {
            const v = urlDraft.trim();
            if (v !== baseUrl) void onUpdate({ baseUrl: v });
          }}
          placeholder={DEFAULT_DAEMON_URL}
          spellCheck={false}
          className="h-8 flex-1 font-mono text-[11.5px]"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void test()}
          disabled={testing}
          className="h-8 px-3 text-[11px]"
        >
          {testing ? "Testing…" : "Test"}
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={
            tokenSaved ? "•••••••• (stored)" : "Access token — paste to set"
          }
          className="h-8 flex-1 text-[11.5px]"
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void saveToken()}
          className="h-8 px-3 text-[11px]"
        >
          Save
        </Button>
      </div>

      {detail && status !== "idle" ? (
        <span className={`text-[10.5px] ${statusColor(status)}`}>{detail}</span>
      ) : null}

      {remote ? (
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          Remote daemon — a token is required, and opening a unit's worktree as
          a Space is unavailable (its files live on another host).
        </p>
      ) : null}
    </div>
  );
}
