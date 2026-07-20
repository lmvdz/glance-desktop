// Collapsible group header (t3-face concern 05) — a roll-up attention dot sits in the chevron
// slot and crossfades to the chevron on hover. Ports t3's exact `group/project-header` idiom
// (pingdotgg/t3code, apps/web/src/components/Sidebar.tsx ~L2204-2245, MIT): the dot is absolutely
// positioned under the chevron, `opacity-0`/`opacity-100` swap on `group-hover/project-header`,
// both `transition-opacity duration-150` — reimplemented against glance's own status-dot/token
// vocabulary (t3's version reads its own `projectStatus.dotClass`/`.pulse`; here it's
// `RollupDot`/`AttentionPill`'s `statusMeta`).

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { LadderPriority } from "../lib/fleetLadder";
import { RollupDot } from "./AttentionPill";

export function GroupHeader({
  label,
  count,
  collapsed,
  rollupPriority,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  /** The group's most-urgent daemon tier (`maxLadderPriority`); undefined for an adopt-only group —
   *  nothing to roll up, so the chevron shows plain. */
  rollupPriority?: LadderPriority;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="group/project-header relative flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {rollupPriority && (
          <span className="absolute inset-0 flex items-center justify-center opacity-100 transition-opacity duration-150 group-hover/project-header:opacity-0">
            <RollupDot priority={rollupPriority} />
          </span>
        )}
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={13}
          className={`absolute inset-0 m-auto shrink-0 text-muted-foreground/70 transition-all duration-150 ${
            rollupPriority
              ? "opacity-0 group-hover/project-header:opacity-100"
              : "opacity-100"
          } ${collapsed ? "" : "rotate-90"}`}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80 group-hover/project-header:text-foreground/85">
        {label}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground/60">
        {count}
      </span>
    </button>
  );
}
