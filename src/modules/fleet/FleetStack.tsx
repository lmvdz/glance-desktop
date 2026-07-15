import { cn } from "@/lib/utils";
import type { FleetTab, Tab } from "@/modules/tabs";
import { FleetPane } from "./FleetPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

// One always-mounted pane per fleet tab, toggled by visibility — mirrors PreviewStack.
// Fleet panes hold no imperative handle (no reload/url), so this is the trimmed version.
export function FleetStack({ tabs, activeId }: Props) {
  const fleet = tabs.filter(
    (t): t is FleetTab => t.kind === "fleet" && !t.cold,
  );
  if (fleet.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {fleet.map((t) => {
        const visible = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <FleetPane visible={visible} />
          </div>
        );
      })}
    </div>
  );
}
