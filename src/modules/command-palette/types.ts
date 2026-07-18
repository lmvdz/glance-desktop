import type { ShortcutId } from "@/modules/shortcuts";
import type { TerminalIcon } from "@hugeicons/core-free-icons";

export type PaletteIcon = typeof TerminalIcon;

export type PaletteItem = {
  id: string;
  title: string;
  group: string;
  keywords?: string[];
  icon?: PaletteIcon;
  iconUrl?: string;
  /** A colored status dot rendered in the leading (icon) slot instead of an icon — the fleet unit
   *  rows' status cluster (t3-face concern 07). `className` is a `bg-*` token utility. */
  leadingDot?: { className: string; pulse?: boolean; label: string };
  shortcutId?: ShortcutId;
  trailing?: string;
  disabledReason?: string;
  run: () => void;
};

export type PaletteMode = "commands" | "history" | "content" | "help";
