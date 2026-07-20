// Three-mode timeline scrolling (r3 borrow 3 — plans/research-t3code round 3). Pure math only;
// ConversationView owns the DOM. Ports the *shape* of t3code's timelineScrollAnchoring.ts +
// resolveChatListAnchoredEndSpace (© 2026 T3 Tools Inc., MIT License) without the LegendList
// dependency — glance's polled, non-virtualized timeline only needs the geometry:
//
//   following-end      stick to the bottom while the user is near it (the classic chat default)
//   anchoring-new-turn on send, pin the just-sent user message ANCHOR_OFFSET_PX from the top of
//                      the viewport and reserve trailing space below it, so the reply streams
//                      DOWNWARD into the reserved space instead of re-scrolling the transcript on
//                      every poll tick — the single most felt "modern chat" signature
//   free-scrolling     the user scrolled away; never move their viewport for them
//
// Mode transitions: a send always enters anchoring-new-turn; any USER scroll resolves to
// following-end (near the bottom) or free-scrolling (anywhere else); programmatic scrolls are
// suppressed by the component so they never masquerade as user intent.

export type TimelineScrollMode =
  | "following-end"
  | "anchoring-new-turn"
  | "free-scrolling";

/** Gap between the viewport top and the anchored user message (t3's CHAT_LIST_ANCHOR_OFFSET). */
export const ANCHOR_OFFSET_PX = 16;

/** Within this many px of the bottom still counts as "at the end" — t3 prefers `isNearEnd` over a
 *  strict bottom check so a sub-row overshoot doesn't strand the user out of following mode. */
export const NEAR_END_THRESHOLD_PX = 40;

export function isNearEnd(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number = NEAR_END_THRESHOLD_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold;
}

/**
 * Height of the trailing spacer that lets the anchored row reach the viewport top even while the
 * reply below it is still short. `anchorTop`/`contentEnd` are offsets in the scroll container's
 * content coordinate space (row.offsetTop with the container as offsetParent). Shrinks to 0 the
 * moment real content below the anchor fills the viewport.
 */
export function resolveAnchorSpacerPx(input: {
  containerHeight: number;
  anchorTop: number;
  contentEnd: number;
}): number {
  const usable = input.containerHeight - ANCHOR_OFFSET_PX;
  const contentBelowAnchor = input.contentEnd - input.anchorTop;
  return Math.max(0, Math.min(usable - contentBelowAnchor, usable));
}

/** The scrollTop that puts the anchor row ANCHOR_OFFSET_PX below the viewport top. */
export function resolveAnchorScrollTop(anchorTop: number): number {
  return Math.max(0, anchorTop - ANCHOR_OFFSET_PX);
}

/** Where a USER scroll (never a programmatic one) lands the mode. */
export function resolveModeOnUserScroll(nearEnd: boolean): TimelineScrollMode {
  return nearEnd ? "following-end" : "free-scrolling";
}
