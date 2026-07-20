import { Message01Icon } from "@hugeicons/core-free-icons";
import {
  memo,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { FleetEmpty } from "./EmptyState";
import type { TranscriptEntry } from "./lib/fleetTranscript";
import { Minimap } from "./timeline/Minimap";
import {
  deriveMinimapDots,
  deriveTimelineRows,
  rowKeyForEntry,
  type TimelineRow,
} from "./timeline/deriveRows";
import {
  isNearEnd,
  resolveAnchorScrollTop,
  resolveAnchorSpacerPx,
  resolveModeOnUserScroll,
  type TimelineScrollMode,
} from "./timeline/scrollAnchoring";
import { stabilizeRows } from "./timeline/stableRows";
import { TimelineRowView } from "./timeline/TimelineRowView";

// The unit's live ACP conversation (I03) — the same session every prompt continues, rendered as
// t3-face's reasoning-first turn-fold timeline (t3-face C09): finished turns collapse behind
// labelled folds (the latest stays expanded), tool calls group into work rows, assistant text is
// real markdown, reasoning collapses, a working row pulses + ticks a live timer, and a right-edge
// minimap of user-message dots scrubs the conversation.
//
// r3 (plans/research-t3code round 3) changes:
//   - This component now OWNS its scroll container (`overflow-y-auto` on the root). The old
//     version put `onScroll` on a non-scrolling div and depended on IntervenePane's wrapper
//     happening to be the scroll parent — React's synthetic onScroll made that work by accident;
//     the coupling was fragile and is gone.
//   - Three-mode scrolling (timeline/scrollAnchoring.ts): following-end / anchoring-new-turn /
//     free-scrolling. A send pins the just-typed message near the viewport top with reserved
//     space below it, so the reply streams downward instead of yanking the transcript.
//   - Derived rows pass through `stabilizeRows` and each row renders behind `memo()` — without
//     the stabilization pass the memo would be a silent no-op (see timeline/stableRows.ts).
//
// PUBLIC INTERFACE IS LOAD-BEARING: IntervenePane.tsx renders `<ConversationView entries={...} />`
// and must keep working — `loading` and `footer` are ADDITIVE optional props; callers that don't
// pass them behave exactly as before, except the component now needs a bounded height to scroll
// within (its hosts give it flex-1/min-h-0).

/** Ghost turn-rows while the first transcript poll is in flight — the unison skeleton sweep, so a
 *  cold-opened unit paints the conversation's shape instead of a blank pane (t3-face C11). */
function TranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-3 py-2" aria-hidden>
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

/** One timeline row + its scroll-target registration. Memoized: with `stabilizeRows` keeping row
 *  object identity stable across poll ticks and the parent keeping the callbacks stable, an idle
 *  poll re-renders ZERO rows. */
const RowShell = memo(function RowShell({
  row,
  onToggleTurn,
  onToggleWorkGroup,
  registerRow,
}: {
  row: TimelineRow;
  onToggleTurn: (id: string) => void;
  onToggleWorkGroup: (groupId: string) => void;
  registerRow: (id: string, el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={(el) => registerRow(row.id, el)}>
      <TimelineRowView
        row={row}
        onToggleTurn={onToggleTurn}
        onToggleWorkGroup={onToggleWorkGroup}
      />
    </div>
  );
});

/** The just-sent message keeps its anchor across the optimistic→server reconcile: the optimistic
 *  entry's row key is its clientTurnId, the echoed server entry has the same clientTurnId but a
 *  real id — resolve by clientTurnId each time rather than pinning a stale row key. */
function findAnchorRowId(
  entries: TranscriptEntry[],
  clientTurnId: string | null,
): string | null {
  if (!clientTurnId) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].clientTurnId === clientTurnId) {
      return rowKeyForEntry(entries[i], i);
    }
  }
  return null;
}

/** Programmatic scrollTop writes fire scroll events asynchronously — ignore mode transitions for
 *  this window after one so they never masquerade as user intent. */
const PROGRAMMATIC_SCROLL_SUPPRESS_MS = 150;

export function ConversationView({
  entries,
  loading = false,
  footer,
}: {
  entries: TranscriptEntry[];
  loading?: boolean;
  /** Rendered after the last turn, INSIDE the conversation's scroll flow (H3's changed-files
   *  card) — scrolls with the transcript, participates in following-end. */
  footer?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const modeRef = useRef<TimelineScrollMode>("following-end");
  const anchorTurnRef = useRef<string | null>(null);
  const suppressUntilRef = useRef(0);
  const [spacerPx, setSpacerPx] = useState(0);

  const [expandedTurns, setExpandedTurns] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedWorkGroups, setExpandedWorkGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const derived = useMemo(
    () => deriveTimelineRows(entries, { expandedTurns, expandedWorkGroups }),
    [entries, expandedTurns, expandedWorkGroups],
  );
  // Structural sharing across renders — an idle 1.5s poll tick reuses every row object (and the
  // array itself), so the memoized rows skip re-rendering entirely.
  const prevRowsRef = useRef<TimelineRow[]>([]);
  const rows = useMemo(() => {
    const stable = stabilizeRows(prevRowsRef.current, derived);
    prevRowsRef.current = stable;
    return stable;
  }, [derived]);
  const minimapDots = useMemo(() => deriveMinimapDots(entries), [entries]);

  const registerRow = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const toggleTurn = useCallback((id: string) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleWorkGroup = useCallback((groupId: string) => {
    setExpandedWorkGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const suppressScrollIntent = () => {
    suppressUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_SUPPRESS_MS;
  };

  // A user send (optimistic entry appended with a clientTurnId) enters anchoring-new-turn.
  const prevEntriesLenRef = useRef(0);
  useLayoutEffect(() => {
    const grew = entries.length > prevEntriesLenRef.current;
    prevEntriesLenRef.current = entries.length;
    if (!grew) return;
    const last = entries[entries.length - 1];
    // Only a LOCAL optimistic send (no seq yet) anchors — a server-delivered user turn from
    // another client scrolling this viewer's transcript would be exactly the yank t3 avoids.
    if (last?.kind === "user" && last.clientTurnId && last.seq === undefined) {
      modeRef.current = "anchoring-new-turn";
      anchorTurnRef.current = last.clientTurnId;
    }
  }, [entries]);

  // Positioning per mode. Runs on every rows/footer/spacer change: following-end re-sticks to the
  // bottom; anchoring re-pins the anchor row and sizes the trailing spacer. The spacer state write
  // re-runs this effect once more with the spacer in the DOM so the scrollTop lands correctly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rows/entries/spacerPx are re-position triggers; the effect reads only refs + DOM
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (modeRef.current === "following-end") {
      suppressScrollIntent();
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (modeRef.current === "anchoring-new-turn") {
      const anchorId = findAnchorRowId(entries, anchorTurnRef.current);
      const rowEl = anchorId ? rowRefs.current.get(anchorId) : undefined;
      const endEl = endRef.current;
      if (!rowEl || !endEl) return;
      const nextSpacer = resolveAnchorSpacerPx({
        containerHeight: el.clientHeight,
        anchorTop: rowEl.offsetTop,
        contentEnd: endEl.offsetTop,
      });
      setSpacerPx((prev) => (Math.abs(prev - nextSpacer) > 1 ? nextSpacer : prev));
      suppressScrollIntent();
      el.scrollTop = resolveAnchorScrollTop(rowEl.offsetTop);
    }
  }, [rows, entries, spacerPx]);

  const scrollToRow = useCallback((id: string) => {
    const el = rowRefs.current.get(id);
    if (!el) return;
    // Jumping to history is an explicit navigation — leave any auto mode.
    modeRef.current = "free-scrolling";
    setSpacerPx(0);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (entries.length === 0) {
    if (loading) return <TranscriptSkeleton />;
    return (
      <div className="flex flex-col gap-3 px-3 py-3">
        <FleetEmpty
          compact
          icon={Message01Icon}
          title="No messages yet"
          description="Send an instruction below to start this unit's first turn."
        />
        {footer}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-y-auto overscroll-contain px-3 py-3"
      onScroll={(ev) => {
        if (performance.now() < suppressUntilRef.current) return;
        const el = ev.currentTarget;
        const next = resolveModeOnUserScroll(
          isNearEnd(el.scrollTop, el.scrollHeight, el.clientHeight),
        );
        if (modeRef.current !== next) {
          modeRef.current = next;
          anchorTurnRef.current = null;
          setSpacerPx(0);
        }
      }}
    >
      <div className="flex gap-1.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {rows.map((row) => (
            <RowShell
              key={row.id}
              row={row}
              onToggleTurn={toggleTurn}
              onToggleWorkGroup={toggleWorkGroup}
              registerRow={registerRow}
            />
          ))}
          {footer}
          <div ref={endRef} />
          {spacerPx > 0 && <div aria-hidden style={{ height: spacerPx }} />}
        </div>
        <Minimap dots={minimapDots} onSelect={scrollToRow} />
      </div>
    </div>
  );
}
