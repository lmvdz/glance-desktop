// Daemon-backed chat transport (fleet-ide-escalation E01). A ChatTransport-shaped object whose
// sendMessages runs a turn against a glance daemon UNIT instead of a BYOK provider: lazily create a
// /api/console unit, steer the user's turn into it (POST /api/command {prompt} — the same ACP session,
// never keystroke injection), and stream the reply back by POLLING the transcript delta (I01's
// ?since=seq; CSP forbids ws://). The whole-entry→delta diffing lives in daemonTranscriptStream.ts.

import type { UIMessage } from "@ai-sdk/react";
import { createUIMessageStream } from "ai";
import type { FleetClient } from "@/modules/fleet/lib/fleetClient";
import {
  maxSeq,
  normalizeTranscript,
} from "@/modules/fleet/lib/fleetTranscript";
import {
  finalizeStream,
  initStreamState,
  latestUserText,
  stepStream,
} from "./daemonTranscriptStream";

const POLL_MS = 1200;
/** Consecutive empty polls after any activity that mark the turn done (~3.6s of quiet). */
const QUIET_POLLS_DONE = 3;
/** Hard ceilings so a stuck unit can never poll forever. */
const START_TIMEOUT_MS = 120_000; // waiting for the unit's first transcript activity
const TOTAL_TIMEOUT_MS = 15 * 60_000; // whole turn

export interface DaemonTransportDeps {
  /** A FleetClient bound to the current daemon URL + token. */
  getClient: () => Promise<FleetClient>;
  /** The repo/workspace root the console unit runs in (null → no workspace open). */
  getRepo: () => string | null;
  /** The console unit already created for this chat session (null until the first turn). */
  getUnitId: () => string | null;
  /** Remember the lazily-created console unit's id (so later turns reuse it, and E02 can promote it). */
  setUnitId: (id: string) => void;
}

type SendOptions = { messages: UIMessage[]; abortSignal?: AbortSignal };

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export function createDaemonChatTransport(deps: DaemonTransportDeps) {
  const sendMessages = (options: SendOptions) => {
    const text = latestUserText(options.messages);
    const signal = options.abortSignal;

    return createUIMessageStream<UIMessage>({
      onError: (e) => (e instanceof Error ? e.message : "daemon chat error"),
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        const fail = (errorText: string) => {
          writer.write({ type: "error", errorText });
          writer.write({ type: "finish" });
        };

        const client = await deps.getClient();

        // 1. Ensure a console unit exists for this session.
        let unitId = deps.getUnitId();
        if (!unitId) {
          const repo = deps.getRepo();
          if (!repo) {
            return fail("Daemon chat needs an open workspace folder.");
          }
          const created = await client.createConsole(
            repo,
            undefined,
            undefined,
            signal,
          );
          if (!created) {
            return fail("Could not start a daemon chat session.");
          }
          unitId = created;
          deps.setUnitId(unitId);
        }

        // 2. Cursor = the unit's current max seq BEFORE steering, so we only stream THIS turn's reply.
        let since = 0;
        try {
          const pre = normalizeTranscript(
            await client.transcript(unitId, undefined, signal),
          );
          since = maxSeq(pre);
        } catch {
          // start from 0 — worst case we replay prior turns once
        }

        // 3. Steer the user's turn into the same ACP session.
        const res = await client.steer(unitId, text, undefined, signal);
        if (!res.ok) return fail(res.detail ?? "steer failed");

        // 4. Poll the transcript delta and stream the reply until the turn settles.
        let st = initStreamState();
        let sawAny = false;
        let quiet = 0;
        const startedAt = Date.now();
        let firstActivityAt = 0;

        while (!signal?.aborted) {
          let delta = [] as ReturnType<typeof normalizeTranscript>;
          try {
            delta = normalizeTranscript(
              await client.transcript(unitId, since, signal),
            );
          } catch {
            // transient — treat as an empty poll
          }

          if (delta.length > 0) {
            since = Math.max(since, maxSeq(delta));
            if (!sawAny) {
              sawAny = true;
              firstActivityAt = Date.now();
            }
            quiet = 0;
            const r = stepStream(st, delta);
            st = r.state;
            for (const chunk of r.chunks) writer.write(chunk);
          } else if (sawAny) {
            quiet++;
            if (quiet >= QUIET_POLLS_DONE) break;
          }

          const now = Date.now();
          if (!sawAny && now - startedAt >= START_TIMEOUT_MS) break;
          if (sawAny && now - firstActivityAt >= TOTAL_TIMEOUT_MS) break;
          if (now - startedAt >= TOTAL_TIMEOUT_MS) break;

          await delay(POLL_MS, signal);
        }

        // 5. Close open blocks and finish.
        for (const chunk of finalizeStream(st)) writer.write(chunk);
        writer.write({ type: "finish" });
      },
    });
  };

  return {
    sendMessages,
    async reconnectToStream(): Promise<null> {
      return null;
    },
  };
}
