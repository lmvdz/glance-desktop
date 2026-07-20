import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AngryIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFleetConnection } from "./store/fleetConnectionStore";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The repo the gripe is filed against — the active workspace cwd, or the selected fleet unit's
   *  repo when a fleet tab is focused (resolved by `resolveGrrRepo` in App). Null disables submit. */
  repo: string | null;
};

/**
 * C3 — native friction capture ("grr"), always reachable (command palette + a global shortcut).
 * A single textarea that POSTs a gripe to the ACTIVE daemon's friction ledger. Mirrors the daemon
 * TUI's Ctrl-G and `glance grr`: same `POST /api/friction {repo, context:"desktop", gripe}` body.
 */
export function GrrModal({ open, onOpenChange, repo }: Props) {
  const [gripe, setGripe] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const getClient = useFleetConnection((s) => s.client);
  const activeId = useFleetConnection((s) => s.activeId);

  useEffect(() => {
    if (!open) return;
    setGripe("");
    setSubmitting(false);
    const handle = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(handle);
  }, [open]);

  const noDaemon = !activeId;
  const noRepo = !repo;
  const canSubmit = !noDaemon && !noRepo && !!gripe.trim() && !submitting;

  const submit = async () => {
    const trimmed = gripe.trim();
    if (!trimmed || !repo || !activeId || submitting) return;
    setSubmitting(true);
    try {
      const client = await getClient();
      const res = await client.grr(repo, trimmed);
      if (res.ok) {
        toast.success("Gripe logged", { icon: <HugeiconsIcon icon={AngryIcon} size={18} /> });
        onOpenChange(false);
      } else {
        toast.error(
          res.unauthorized ? "Fleet daemon rejected the token" : "Couldn't log gripe",
          { description: res.detail },
        );
        setSubmitting(false);
      }
    } catch (err) {
      toast.error("Couldn't reach the fleet daemon", {
        description: err instanceof Error ? err.message : String(err),
      });
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.75">
            <HugeiconsIcon icon={AngryIcon} size={16} strokeWidth={1.75} />
            Capture friction
          </DialogTitle>
          <DialogDescription>
            What's grinding your gears? It lands in the active daemon's dogfood
            ledger — no ceremony, just the gripe.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          ref={textareaRef}
          value={gripe}
          onChange={(e) => setGripe(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (canSubmit) void submit();
            }
          }}
          placeholder="The thing that just annoyed you…"
          disabled={noDaemon || submitting}
          className="min-h-24"
        />
        {noDaemon ? (
          <div className="text-xs text-warning-foreground">
            No fleet daemon connected — add one in Settings → Fleet.
          </div>
        ) : noRepo ? (
          <div className="text-xs text-warning-foreground">
            Open a workspace or select a fleet unit to attach this gripe.
          </div>
        ) : (
          <div className="truncate text-xs text-muted-foreground">
            Filing against <span className="font-mono">{repo}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? "Logging…" : "Log gripe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
