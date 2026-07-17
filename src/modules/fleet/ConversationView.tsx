import { useEffect, useRef } from "react";
import type { TranscriptEntry, TranscriptKind } from "./lib/fleetTranscript";

// The unit's live ACP conversation (I03) — the same session every prompt continues, rendered turn
// by turn. Reads the accumulated transcript from the store; auto-scrolls to the newest turn unless
// the user has scrolled up to read history.

const KIND_LABEL: Record<TranscriptKind, string> = {
  user: "you",
  assistant: "agent",
  thinking: "thinking",
  tool: "tool",
  system: "system",
};

function Turn({ e }: { e: TranscriptEntry }) {
  const body = e.displayText ?? e.text;
  if (e.kind === "tool") {
    return (
      <div className="rounded-md border border-border/60 bg-muted/50 px-2.5 py-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-mono font-medium text-info-foreground">
            {e.tool?.name ?? "tool"}
          </span>
          {e.status && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {e.status}
            </span>
          )}
        </div>
        {e.tool?.resultText && (
          <div className="mt-0.5 line-clamp-3 font-mono text-[10.5px] text-muted-foreground">
            {e.tool.resultText}
          </div>
        )}
      </div>
    );
  }
  const tone =
    e.kind === "user"
      ? "border-success/30 bg-success/10"
      : e.kind === "thinking" || e.kind === "system"
        ? "border-transparent bg-transparent"
        : "border-border/60 bg-card";
  const textTone =
    e.kind === "thinking" || e.kind === "system"
      ? "text-muted-foreground/70 italic"
      : "text-foreground";
  return (
    <div className={`rounded-md border px-2.5 py-1.5 ${tone}`}>
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {KIND_LABEL[e.kind]}
      </div>
      <div
        className={`whitespace-pre-wrap break-words text-[12px] leading-relaxed ${textTone}`}
      >
        {body}
      </div>
    </div>
  );
}

export function ConversationView({ entries }: { entries: TranscriptEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  // Auto-scroll to the newest turn, but only if the user was already at the bottom (don't yank them
  // away from history they scrolled up to read). The effect reads only refs; `entries` is the change
  // trigger, not a body read — the intended dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: entries is the scroll trigger, not read
  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="py-6 text-center text-[11px] text-muted-foreground/70">
        No conversation yet — send an instruction below.
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1.5"
      onScroll={(ev) => {
        const el = ev.currentTarget;
        atBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {entries.map((e) => (
        <Turn key={e.id ?? e.seq ?? e.clientTurnId ?? `${e.kind}-${e.ts}`} e={e} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
