import { cn } from "@/lib/utils";
import type { DiffViewMode } from "./DiffFile";

/**
 * Shared split⇄unified + soft-wrap control for every diff surface (t3 DiffPanel
 * idiom). Hand-rolled as plain buttons rather than the shadcn ToggleGroup/Switch
 * primitives on purpose: those aren't otherwise in the main-window bundle, and
 * pulling radix Toggle + class-variance-authority in just for this control blew
 * the fork's razor-thin client-JS budget (concern 10 escape-hatch). All styling
 * is in t3face.css (tokens, free re: size).
 */
export function DiffViewToggle({
  view,
  onView,
  wrap,
  onWrap,
  className,
}: {
  view: DiffViewMode;
  onView: (v: DiffViewMode) => void;
  wrap: boolean;
  onWrap: (v: boolean) => void;
  className?: string;
}) {
  return (
    <div className={cn("diff-toggle", className)}>
      <div className="diff-seg">
        <button
          type="button"
          data-active={view === "unified" || undefined}
          aria-pressed={view === "unified"}
          onClick={() => onView("unified")}
        >
          Unified
        </button>
        <button
          type="button"
          data-active={view === "split" || undefined}
          aria-pressed={view === "split"}
          onClick={() => onView("split")}
        >
          Split
        </button>
      </div>
      <button
        type="button"
        className="diff-wrap-btn"
        data-active={wrap || undefined}
        aria-pressed={wrap}
        onClick={() => onWrap(!wrap)}
      >
        Wrap
      </button>
    </div>
  );
}
