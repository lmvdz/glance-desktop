// Ported verbatim from t3code (pingdotgg/t3code, MIT © 2026 T3 Tools Inc.),
// apps/web/src/components/composerInlineChip.ts — pure class-string constants,
// no logic. Source: https://github.com/pingdotgg/t3code
//
// Used to give the composer's chip TRAY (below the input — a plain <textarea>
// can't host t3's inline chips, see plans/t3-face/08-composer-shell.md) the
// same look t3 gives its inline composer chips, distinct from the app's
// general-purpose `Chip` component used elsewhere (terminal env badges, etc).
//
// The upstream file also exports a fuchsia "skill chip" variant for a concept
// (t3 skills) this app has no analog for; it is intentionally NOT ported here
// (nothing in our composer tray needs it, and it's a raw-palette color this
// program's tokens-only discipline wouldn't otherwise introduce).

const INLINE_CHIP_CLASS_NAME =
  "inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-accent/40 px-1.5 py-px font-medium text-[12px] leading-[1.1] text-foreground align-middle";

export const CHAT_INLINE_CHIP_CLASS_NAME = INLINE_CHIP_CLASS_NAME;

export const COMPOSER_INLINE_CHIP_CLASS_NAME = `${INLINE_CHIP_CLASS_NAME} select-none`;

export const COMPOSER_INLINE_CHIP_ICON_CLASS_NAME =
  "size-3.5 shrink-0 opacity-85";

export const CHAT_INLINE_CHIP_LABEL_CLASS_NAME = "truncate leading-tight";

export const COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME = `${CHAT_INLINE_CHIP_LABEL_CLASS_NAME} select-none`;

export const COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME =
  "ml-0.5 inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/72 transition-colors hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
