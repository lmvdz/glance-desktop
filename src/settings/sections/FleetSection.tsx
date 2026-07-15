import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FleetClient, normalizeBaseUrl } from "@/modules/fleet";
import {
  DEFAULT_DAEMON_URL,
  getDaemonUrl,
  setDaemonUrl,
} from "@/modules/fleet/lib/fleetConfig";
import {
  clearFleetToken,
  getFleetToken,
  setFleetToken,
} from "@/modules/fleet/lib/fleetKeyring";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

type ProbeState =
  | { kind: "idle" | "testing" }
  | { kind: "result"; ok: boolean; detail: string };

export function FleetSection() {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({ kind: "idle" });

  useEffect(() => {
    void (async () => {
      setUrl(await getDaemonUrl());
      setTokenSaved((await getFleetToken()) !== null);
    })();
  }, []);

  const saveUrl = async () => {
    await setDaemonUrl(normalizeBaseUrl(url) || DEFAULT_DAEMON_URL);
    setUrl(normalizeBaseUrl(url) || DEFAULT_DAEMON_URL);
  };

  const saveToken = async () => {
    if (token.trim()) {
      await setFleetToken(token);
      setToken("");
      setTokenSaved(true);
    } else {
      await clearFleetToken();
      setTokenSaved(false);
    }
  };

  const testConnection = async () => {
    setProbe({ kind: "testing" });
    await saveUrl();
    const client = new FleetClient({
      baseUrl: normalizeBaseUrl(url) || DEFAULT_DAEMON_URL,
      token: await getFleetToken(),
    });
    const h = await client.health();
    setProbe({
      kind: "result",
      ok: h.status === "connected",
      detail: h.detail,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Fleet daemon"
        description="Connect this cockpit to a glance daemon to manage the agent fleet. The token is stored in your OS keychain, never in plaintext."
      />

      <div className="flex flex-col gap-2">
        <SettingRow
          title="Daemon URL"
          description="e.g. http://127.0.0.1:7878 — a loopback daemon on this machine."
        >
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => void saveUrl()}
            placeholder={DEFAULT_DAEMON_URL}
            className="h-8 w-64 text-[12px]"
          />
        </SettingRow>

        <SettingRow
          title="Access token"
          description={
            tokenSaved
              ? "A token is stored. Enter a new one to replace it, or leave blank and save to clear."
              : "Optional for a loopback daemon; required when the daemon has auth configured."
          }
        >
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={tokenSaved ? "•••••••• (stored)" : "paste token"}
              className="h-8 w-48 text-[12px]"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void saveToken()}
            >
              Save
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          title="Connection"
          description="Verify the cockpit can reach the daemon with the current URL + token."
        >
          <div className="flex items-center gap-3">
            {probe.kind === "result" && (
              <span
                className={`text-[11px] ${probe.ok ? "text-emerald-500" : "text-red-500"}`}
              >
                {probe.ok ? "✓ " : "✗ "}
                {probe.detail}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => void testConnection()}
              disabled={probe.kind === "testing"}
            >
              {probe.kind === "testing" ? "Testing…" : "Test connection"}
            </Button>
          </div>
        </SettingRow>
      </div>
    </div>
  );
}
