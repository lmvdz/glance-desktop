// Row renderers for the t3-face reasoning-first timeline (t3-face C09). Each `TimelineRow` variant
// (see deriveRows.ts) gets one component here; `ConversationView` just switches on `row.kind`.
//
// Reuses the fork's ai-elements (Message/MessageContent/MessageResponse for real markdown,
// Reasoning/ReasoningTrigger/ReasoningContent for the collapsible thinking block) rather than
// t3's own row components — the AI SDK's `Tool` component is typed against `ToolUIPart`/
// `DynamicToolUIPart` (a `state` union glance's `TranscriptTool` doesn't share), so tool/work
// rows here are a small bespoke renderer in the same visual grammar (status dot + icon + label)
// instead of forcing an incompatible type through it.

import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { cn } from "@/lib/utils";
import type { TranscriptEntry, TranscriptStatus } from "../lib/fleetTranscript";
import { formatDuration, type TimelineRow } from "./deriveRows";

// Dynamic import — a lazy boundary the eager-graph budget tracer respects — see
// AssistantMarkdown.tsx's header for why the markdown stack can't be a static import here.
const AssistantMarkdown = lazy(() =>
  import("@/components/ai-elements/message").then((m) => ({
    default: ({ text, streaming }: { text: string; streaming: boolean }) => (
      <m.Message from="assistant">
        <m.MessageContent>
          <m.MessageResponse streaming={streaming}>{text}</m.MessageResponse>
        </m.MessageContent>
      </m.Message>
    ),
  })),
);

const USER_BUBBLE_COLLAPSE_PX = 168;

function UserBubble({ entry }: { entry: TranscriptEntry }) {
  const text = entry.displayText ?? entry.text;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isLong, setIsLong] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // `text` isn't read in the body — it's the trigger: re-measure whenever the message content
  // (and therefore its rendered height) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text is the re-measure trigger, not read
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setIsLong(el.scrollHeight > USER_BUBBLE_COLLAPSE_PX + 4);
  }, [text]);

  const collapsed = isLong && !expanded;

  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-secondary px-3 py-2 text-[12px] leading-relaxed text-secondary-foreground">
        <div
          ref={bodyRef}
          className={cn(
            "whitespace-pre-wrap wrap-break-word",
            collapsed &&
              "overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_65%,transparent_100%)]",
          )}
          style={collapsed ? { maxHeight: USER_BUBBLE_COLLAPSE_PX } : undefined}
        >
          {text}
        </div>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 cursor-pointer text-[10.5px] font-medium text-secondary-foreground/70 hover:text-secondary-foreground hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ entry }: { entry: TranscriptEntry }) {
  const text = entry.displayText ?? entry.text;
  const streaming = entry.status === "running";
  return (
    <Suspense
      fallback={
        <div className="whitespace-pre-wrap wrap-break-word text-[12px] leading-relaxed text-foreground">
          {text}
        </div>
      }
    >
      <AssistantMarkdown text={text} streaming={streaming} />
    </Suspense>
  );
}

function ThinkingBlock({ entry }: { entry: TranscriptEntry }) {
  const text = entry.displayText ?? entry.text;
  const streaming = entry.status === "running";
  return (
    <Reasoning isStreaming={streaming} defaultOpen={streaming}>
      <ReasoningTrigger />
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}

function SystemMessage({ entry }: { entry: TranscriptEntry }) {
  const text = entry.displayText ?? entry.text;
  const isPendingGate = entry.status === "running" && !!entry.pending;
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-[11.5px] italic leading-relaxed",
        isPendingGate
          ? "border-warning/40 bg-warning/10 text-warning-foreground"
          : "border-transparent bg-transparent text-muted-foreground/70",
      )}
    >
      {text}
    </div>
  );
}

function MessageRowView({ entry }: { entry: TranscriptEntry }) {
  switch (entry.kind) {
    case "user":
      return <UserBubble entry={entry} />;
    case "assistant":
      return <AssistantMessage entry={entry} />;
    case "thinking":
      return <ThinkingBlock entry={entry} />;
    default:
      return <SystemMessage entry={entry} />;
  }
}

const TOOL_STATUS_DOT: Record<TranscriptStatus, string> = {
  running: "bg-info animate-status-pulse",
  ok: "border border-muted-foreground/40 bg-transparent",
  error: "bg-destructive",
  cancelled: "bg-muted-foreground/40",
};

function ToolLine({ entry }: { entry: TranscriptEntry }) {
  const status: TranscriptStatus = entry.status ?? "ok";
  const name = entry.tool?.name ?? "tool";
  const summary =
    entry.tool?.argsText ??
    (entry.tool?.args !== undefined ? JSON.stringify(entry.tool.args) : undefined);
  const result = entry.tool?.resultText ?? entry.tool?.partialText;
  const isError = Boolean(entry.tool?.isError) || status === "error";

  return (
    <div className="flex flex-col gap-0.5 rounded-md px-2 py-1 text-[11.5px]">
      <div className="flex items-center gap-2">
        <span
          className={cn("size-1.5 shrink-0 rounded-full", TOOL_STATUS_DOT[status])}
          role="img"
          aria-label={status}
        />
        <HugeiconsIcon
          icon={ToolsIcon}
          size={12}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <span className="shrink-0 font-medium text-foreground">{name}</span>
        {summary ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">
            {summary}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {entry.tool?.durationMs != null && (
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            {formatDuration(entry.tool.durationMs)}
          </span>
        )}
        {isError && (
          <span className="shrink-0 text-[10px] font-medium text-destructive">failed</span>
        )}
      </div>
      {result && (
        <div className="ml-5 line-clamp-3 font-mono text-[10.5px] text-muted-foreground">
          {result}
        </div>
      )}
    </div>
  );
}

function WorkRowView({
  row,
  onToggleWorkGroup,
}: {
  row: Extract<TimelineRow, { kind: "work" }>;
  onToggleWorkGroup: (groupId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {row.expanded && row.hidden.map((e, i) => <ToolLine key={e.id ?? `${row.groupId}-h-${i}`} entry={e} />)}
      {row.hidden.length > 0 && (
        <button
          type="button"
          onClick={() => onToggleWorkGroup(row.groupId)}
          className="ml-5 flex w-fit cursor-pointer items-center gap-1 text-[10.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon
            icon={row.expanded ? ArrowDown01Icon : ArrowRight01Icon}
            size={10}
            strokeWidth={2}
          />
          {row.expanded
            ? "Hide previous tool calls"
            : `+${row.hidden.length} previous tool call${row.hidden.length === 1 ? "" : "s"}`}
        </button>
      )}
      {row.visible.map((e, i) => <ToolLine key={e.id ?? `${row.groupId}-v-${i}`} entry={e} />)}
    </div>
  );
}

function TurnFoldRowView({
  row,
  onToggleTurn,
}: {
  row: Extract<TimelineRow, { kind: "turn-fold" }>;
  onToggleTurn: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggleTurn(row.id)}
      className="my-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <HugeiconsIcon
        icon={row.expanded ? ArrowDown01Icon : ArrowRight01Icon}
        size={11}
        strokeWidth={2}
      />
      {row.label}
    </button>
  );
}

/** Staggered pulse dots + a "Working for Xs" timer that ticks WITHOUT a React commit every
 *  second — the timer span's textContent is mutated directly through a ref on a 1s interval, so a
 *  long-running turn never re-renders the whole timeline once a second just to update a clock. */
function WorkingRowView({ startedAt }: { startedAt: number | null }) {
  const timerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (startedAt == null) return;
    const tick = () => {
      const el = timerRef.current;
      if (!el) return;
      const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      el.textContent = `Working for ${secs}s`;
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <div className="flex items-center gap-2 py-1.5 pl-1 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-info [animation-delay:0ms] animate-status-pulse" />
        <span className="size-1.5 rounded-full bg-info [animation-delay:160ms] animate-status-pulse" />
        <span className="size-1.5 rounded-full bg-info [animation-delay:320ms] animate-status-pulse" />
      </span>
      <span ref={timerRef}>{startedAt != null ? "Working…" : "Working"}</span>
    </div>
  );
}

export function TimelineRowView({
  row,
  onToggleTurn,
  onToggleWorkGroup,
}: {
  row: TimelineRow;
  onToggleTurn: (id: string) => void;
  onToggleWorkGroup: (groupId: string) => void;
}) {
  switch (row.kind) {
    case "message":
      return <MessageRowView entry={row.entry} />;
    case "work":
      return <WorkRowView row={row} onToggleWorkGroup={onToggleWorkGroup} />;
    case "turn-fold":
      return <TurnFoldRowView row={row} onToggleTurn={onToggleTurn} />;
    case "working":
      return <WorkingRowView startedAt={row.startedAt} />;
    default:
      return null;
  }
}
