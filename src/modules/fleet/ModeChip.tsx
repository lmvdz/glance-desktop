// Autonomy-mode chip for the steer composer's footer (hub-shell H4, r3 — plans/research-t3code
// round 3). The one per-thread control the daemon serves TODAY (`autonomyMode` + setMode);
// model/effort/access chips wait on the H7 daemon gaps rather than rendering dead controls.
// Dropdown (not a cycle-on-click) so the mode change is a deliberate pick with descriptions.

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const MODES: { value: string; label: string; description: string }[] = [
  { value: "observe", label: "Observe", description: "Watch only — the agent takes no turns." },
  { value: "assist", label: "Assist", description: "Acts when steered; waits for you between turns." },
  { value: "autodrive", label: "Autodrive", description: "Drives autonomously until it needs you." },
];

export function ModeChip({
  mode,
  onSetMode,
}: {
  /** The unit's current `autonomyMode` from the roster poll. */
  mode?: string;
  /** Persist the pick on the unit's own daemon; rejects surface via the composer's error line. */
  onSetMode: (mode: string) => Promise<void>;
}) {
  // Optimistic display until the roster poll confirms (or the write fails and we snap back).
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  useEffect(() => {
    if (pendingMode && mode === pendingMode) setPendingMode(null);
  }, [mode, pendingMode]);

  const shown = pendingMode ?? mode;
  const current = MODES.find((m) => m.value === shown);

  const pick = async (value: string) => {
    if (value === shown) return;
    setPendingMode(value);
    try {
      await onSetMode(value);
    } catch {
      setPendingMode(null); // the write failed — snap back to the daemon's truth
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Autonomy mode"
        className={cn(
          "flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border/60 px-1.5",
          "text-[10.5px] font-medium text-foreground/75 transition-colors hover:bg-accent hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring",
          pendingMode && "opacity-60",
        )}
      >
        {current?.label ?? shown ?? "Mode"}
        <HugeiconsIcon icon={ArrowDown01Icon} size={10} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m.value}
            onSelect={() => void pick(m.value)}
            className="flex flex-col items-start gap-0.5"
          >
            <span className={cn("text-xs font-medium", m.value === shown && "text-primary")}>
              {m.label}
            </span>
            <span className="text-[11px] text-muted-foreground">{m.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
