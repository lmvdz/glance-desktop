import { useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptEntry } from "./lib/fleetTranscript";
import { Minimap } from "./timeline/Minimap";
import { deriveMinimapDots, deriveTimelineRows } from "./timeline/deriveRows";
import { TimelineRowView } from "./timeline/TimelineRowView";

// The unit's live ACP conversation (I03) — the same session every prompt continues, rendered as
// t3-face's reasoning-first turn-fold timeline (t3-face C09): finished turns collapse behind
// labelled folds (the latest stays expanded), tool calls group into work rows, assistant text is
// real markdown, reasoning collapses, a working row pulses + ticks a live timer, and a right-edge
// minimap of user-message dots scrubs the conversation. Row derivation lives in
// timeline/deriveRows.ts (ported from t3code's MessagesTimeline.logic.ts — see that file's header
// for provenance); this component owns only expansion state, auto-scroll, and scroll-to-message.
//
// PUBLIC INTERFACE IS LOAD-BEARING: IntervenePane.tsx renders `<ConversationView entries={...} />`
// and must keep working with zero edits — this rewrite only touches internals.

export function ConversationView({ entries }: { entries: TranscriptEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const [expandedTurns, setExpandedTurns] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedWorkGroups, setExpandedWorkGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const rows = useMemo(
    () => deriveTimelineRows(entries, { expandedTurns, expandedWorkGroups }),
    [entries, expandedTurns, expandedWorkGroups],
  );
  const minimapDots = useMemo(() => deriveMinimapDots(entries), [entries]);

  // Auto-scroll to the newest turn, but only if the user was already at the bottom (don't yank them
  // away from history they scrolled up to read). The effect reads only refs; `entries` is the change
  // trigger, not a body read — the intended dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: entries is the scroll trigger, not read
  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  const toggleTurn = (id: string) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleWorkGroup = (groupId: string) => {
    setExpandedWorkGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const scrollToRow = (id: string) => {
    rowRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (entries.length === 0) {
    return (
      <div className="py-6 text-center text-[11px] text-muted-foreground/70">
        No conversation yet — send an instruction below.
      </div>
    );
  }

  return (
    <div
      className="flex gap-1.5"
      onScroll={(ev) => {
        const el = ev.currentTarget;
        atBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.id}
            ref={(el) => {
              if (el) rowRefs.current.set(row.id, el);
              else rowRefs.current.delete(row.id);
            }}
          >
            <TimelineRowView
              row={row}
              onToggleTurn={toggleTurn}
              onToggleWorkGroup={toggleWorkGroup}
            />
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <Minimap dots={minimapDots} onSelect={scrollToRow} />
    </div>
  );
}
