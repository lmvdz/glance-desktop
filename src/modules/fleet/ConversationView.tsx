import { Message01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { FleetEmpty } from "./EmptyState";
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
// and must keep working — `loading` is an ADDITIVE optional prop (t3-face C11), so callers that
// don't pass it behave exactly as before.

/** Ghost turn-rows while the first transcript poll is in flight — the unison skeleton sweep, so a
 *  cold-opened unit paints the conversation's shape instead of a blank pane (t3-face C11). */
function TranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-2" aria-hidden>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/3 rounded-2xl" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-11/12 rounded" />
        <Skeleton className="h-4 w-4/5 rounded" />
        <Skeleton className="h-4 w-3/5 rounded" />
      </div>
    </div>
  );
}

export function ConversationView({
  entries,
  loading = false,
}: {
  entries: TranscriptEntry[];
  loading?: boolean;
}) {
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
    if (loading) return <TranscriptSkeleton />;
    return (
      <FleetEmpty
        compact
        icon={Message01Icon}
        title="No messages yet"
        description="Send an instruction below to start this unit's first turn."
      />
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
