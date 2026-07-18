import { ArrowUpIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  /** The composer's own input (a textarea, plus whatever pickers it wires up). */
  children: ReactNode;
  /** Chip tray, rendered BELOW the input — a plain <textarea> can't host t3's inline
   *  chips, so attachments/context render here instead (see composerInlineChip.ts). */
  chips?: ReactNode;
  /** Footer toolbar, left slot — pickers/mode toggles. */
  footerLeft?: ReactNode;
  /** Footer toolbar, right slot — extra primary actions rendered before the send/stop
   *  button (which the shell always renders itself, further right still). */
  footerRight?: ReactNode;
  /** True while this composer's own turn is in flight — flips the button to a stop
   *  square wired to `onStop` instead of a send arrow wired to `onSend`. Per t3 (and
   *  current fleet behavior), this never itself disables the button: you can always
   *  stop, and — no queue toggle — you can still send while the other side is busy. */
  running: boolean;
  onSend: () => void;
  onStop: () => void;
  /** Whether sending is currently valid (ignored while `running`, see above). */
  canSend: boolean;
  sendTitle?: string;
  className?: string;
};

/** Shared presentational glass shell for both composers (AI chat + fleet steer) — t3's
 *  geometry (rounded frame, focus-ring border, footer toolbar, round send↔stop button)
 *  over whatever the caller's actual input is. Purely presentational: no state, no
 *  behavior beyond the send/stop button click, so it never regresses whatever the
 *  wrapped composer already does. See plans/t3-face/08-composer-shell.md. */
export function ComposerShell({
  children,
  chips,
  footerLeft,
  footerRight,
  running,
  onSend,
  onStop,
  canSend,
  sendTitle = "Send",
  className,
}: Props) {
  const disabled = !running && !canSend;
  return (
    <div className={cn("rounded-[22px] p-px", className)}>
      <div
        className={cn(
          "chat-composer-glass chat-composer-shared-blur",
          "flex flex-col gap-1.5 rounded-[20px] border border-border/60 p-2.5",
          "has-focus-visible:border-ring/45",
        )}
      >
        {/* Not a flex row: the AI composer's input slot stacks its textarea
            above a voice-status row, and the fleet composer's is a single
            textarea — both just want normal block stacking. */}
        <div className="flex flex-col gap-1">{children}</div>

        {chips && (
          <div className="flex flex-wrap items-center gap-1.5 px-0.5">
            {chips}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {footerLeft}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {footerRight}
            <button
              type="button"
              onClick={running ? onStop : onSend}
              disabled={disabled}
              title={running ? "Stop" : sendTitle}
              aria-label={running ? "Stop" : "Send"}
              className={cn(
                "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-30",
                running
                  ? "bg-destructive/90 text-destructive-foreground hover:bg-destructive"
                  : "bg-primary/90 text-primary-foreground hover:bg-primary",
              )}
            >
              {running ? (
                <span
                  aria-hidden
                  className="size-3 rounded-[2px] bg-current"
                />
              ) : (
                <HugeiconsIcon icon={ArrowUpIcon} size={16} strokeWidth={2.25} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
