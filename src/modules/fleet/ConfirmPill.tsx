// Two-step destructive confirm (t3-face concern 11). A destructive action that can't be undone with
// one click — interrupting a unit that's mid-turn — arms on the first click ("Interrupt?") and only
// fires on the second, auto-disarming after a few seconds if the operator walks away. Keeps the
// happy path one click for the non-destructive case (the caller just renders a plain button then).
// Transition-only affordance; no keyframe animation, so reduced-motion has nothing to suppress.

import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const DISARM_MS = 3000;

export function ConfirmPill({
  icon,
  label,
  confirmLabel,
  onConfirm,
  disabled,
  title,
  className,
}: {
  icon: React.ComponentProps<typeof HugeiconsIcon>["icon"];
  /** Resting label ("Take over"). */
  label: string;
  /** Armed label ("Interrupt & take over?"). */
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const disarm = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setArmed(false);
  };

  const handleClick = () => {
    if (disabled) return;
    if (!armed) {
      setArmed(true);
      timerRef.current = setTimeout(disarm, DISARM_MS);
      return;
    }
    disarm();
    onConfirm();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onBlur={disarm}
      disabled={disabled}
      title={title}
      className={cn(
        "flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        armed
          ? "border-warning/50 bg-warning/10 font-medium text-warning-foreground"
          : "border-border/60 text-foreground/75 hover:bg-accent",
        className,
      )}
    >
      <HugeiconsIcon icon={icon} size={13} />
      {armed ? confirmLabel : label}
    </button>
  );
}
