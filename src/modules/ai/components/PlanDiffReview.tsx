import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DiffFile,
  type DiffViewMode,
  DiffViewToggle,
  lineDiff,
} from "@/modules/fleet/diffs";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  FileEditIcon,
  FilePlusIcon,
  FolderAddIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { usePlanStore, type QueuedEdit } from "../store/planStore";

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function diffStats(
  original: string,
  proposed: string,
): { added: number; removed: number } {
  const a = original.split("\n");
  const b = proposed.split("\n");
  const setA = new Set(a);
  const setB = new Set(b);
  let added = 0;
  let removed = 0;
  for (const line of b) if (!setA.has(line)) added++;
  for (const line of a) if (!setB.has(line)) removed++;
  return { added, removed };
}

export function PlanDiffReview() {
  const queue = usePlanStore((s) => s.queue);
  const removeOne = usePlanStore((s) => s.removeOne);
  const clear = usePlanStore((s) => s.clear);
  const applyAll = usePlanStore((s) => s.applyAll);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<DiffViewMode>("unified");
  const [wrap, setWrap] = useState(false);

  if (queue.length === 0) return null;

  const onApply = async () => {
    setBusy(true);
    try {
      const results = await applyAll();
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        console.error("plan apply failures:", failed);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background/85 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold tracking-tight">
            Plan review
          </span>
          <span className="text-[10.5px] text-muted-foreground">
            {queue.length} pending change{queue.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <DiffViewToggle
            view={view}
            onView={setView}
            wrap={wrap}
            onWrap={setWrap}
            className="mr-1"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-[11px] hover:bg-destructive/10 hover:text-destructive"
            onClick={() => clear()}
            disabled={busy}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
            Discard all
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1.5 text-[11px]"
            onClick={onApply}
            disabled={busy}
          >
            <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} />
            Apply {queue.length}
          </Button>
        </div>
      </div>
      <ul className="flex flex-1 flex-col gap-1.5 overflow-auto p-3">
        {queue.map((q) => (
          <PlanRow
            key={q.id}
            item={q}
            view={view}
            wrap={wrap}
            onReject={() => removeOne(q.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function PlanRow({
  item,
  view,
  wrap,
  onReject,
}: {
  item: QueuedEdit;
  view: DiffViewMode;
  wrap: boolean;
  onReject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isDir = item.kind === "create_directory";
  const isNew = item.isNewFile && !isDir;
  const stats = isDir
    ? null
    : diffStats(item.originalContent, item.proposedContent);
  const Icon = isDir
    ? FolderAddIcon
    : isNew
      ? FilePlusIcon
      : FileEditIcon;

  return (
    <li className="group/row overflow-hidden rounded-md border border-border/50 bg-card">
      <div className="flex items-start gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => !isDir && setOpen((v) => !v)}
          disabled={isDir}
          className={cn(
            "mt-0.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
            isDir && "invisible",
          )}
          aria-label="Toggle diff"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={1.75} />
        </button>
        <HugeiconsIcon
          icon={Icon}
          size={13}
          strokeWidth={1.75}
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 font-mono text-[11.5px]">
            <span className="truncate text-foreground">
              {basename(item.path)}
            </span>
            {isNew ? (
              <span className="text-[10px] text-success-foreground">new</span>
            ) : null}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {item.path}
          </div>
          {stats ? (
            <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums">
              <span className="text-success-foreground">+{stats.added}</span>
              <span className="text-destructive">−{stats.removed}</span>
              <span className="text-muted-foreground">
                {item.kind === "multi_edit" ? "multi-edit" : item.kind}
              </span>
            </div>
          ) : (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {item.description ?? "create directory"}
            </div>
          )}
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-5 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100"
          onClick={onReject}
          aria-label="Reject"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
        </Button>
      </div>
      {open && !isDir ? (
        <div className="border-t border-border/40 bg-muted/20 px-2.5 py-2">
          <PlanRowDiff
            original={item.originalContent}
            proposed={item.proposedContent}
            view={view}
            wrap={wrap}
          />
        </div>
      ) : null}
    </li>
  );
}

function PlanRowDiff({
  original,
  proposed,
  view,
  wrap,
}: {
  original: string;
  proposed: string;
  view: DiffViewMode;
  wrap: boolean;
}) {
  // Real LCS line diff (interleaved context/add/del), rendered through the
  // shared t3 diff surface — the same renderer the fleet IntervenePane uses.
  const parsed = useMemo(
    () => lineDiff(original, proposed),
    [original, proposed],
  );
  return (
    <div className="max-h-72 overflow-auto">
      <DiffFile file="" parsed={parsed} view={view} wrap={wrap} />
    </div>
  );
}

