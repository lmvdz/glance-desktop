// The Changed-files card (hub-shell H3, r3 borrow 1 — plans/research-t3code round 3): t3code's
// signature turn artifact, rendered in the conversation flow after the latest turn. Sticky
// summary header ("Changed files (N) · +x −y", Expand/Collapse all, view toggle), a compacted
// path tree with per-file diffstats, and per-file inline expansion into the existing DiffFile
// renderer (split/unified preserved, line-quote → composer intact). Visual/behavior shape ported
// from t3code's ChangedFilesTree/AssistantChangedFilesSection (© 2026 T3 Tools Inc., MIT
// License); the diff renderer stays glance's own (concern 10's no-@pierre/diffs decision).
//
// Data honesty: the daemon serves a WHOLE-WORKTREE diff (client.diff(unit.id)), so this card is
// "the unit's uncommitted changes so far", not a per-turn attribution — per-turn diffs are an H7
// daemon gap. The card renders once per unit below the transcript, never per turn, so it can't
// imply attribution it doesn't have.

import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  File01Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useChangedFilesStore } from "../store/changedFilesStore";
import type { FleetFileDiff } from "../lib/fleetIntervene";
import { DiffFile } from "./DiffFile";
import { DiffStatLabel } from "./DiffStatLabel";
import type { DiffViewMode } from "./DiffFile";
import { DiffViewToggle } from "./DiffViewToggle";
import type { QuotePayload } from "./DiffFile";
import {
  buildFileTree,
  countDiffStats,
  type FileChangeStat,
  flattenTree,
} from "./fileTree";
import { parseUnifiedDiff } from "./parseDiff";

export function ChangedFilesCard({
  unitKey,
  diff,
  error,
  onQuote,
}: {
  /** M02 `daemonId:id` key — scopes the persisted collapse preference. */
  unitKey: string;
  /** null → still loading; [] → clean worktree. */
  diff: FleetFileDiff[] | null;
  error: string | null;
  onQuote: (p: QuotePayload) => void;
}) {
  const collapsed = useChangedFilesStore((s) => Boolean(s.collapsedCards[unitKey]));
  const setCardCollapsed = useChangedFilesStore((s) => s.setCardCollapsed);

  const [view, setView] = useState<DiffViewMode>("unified");
  const [wrap, setWrap] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set());
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(() => new Set());

  // Parse each file's diff once; stats + tree derive from the same parse the renderer uses.
  const parsedByFile = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseUnifiedDiff>>();
    for (const fd of diff ?? []) map.set(fd.file, parseUnifiedDiff(fd.diff));
    return map;
  }, [diff]);

  const stats: FileChangeStat[] = useMemo(
    () =>
      (diff ?? []).map((fd) => {
        const parsed = parsedByFile.get(fd.file);
        const counts = parsed ? countDiffStats(parsed) : { additions: 0, deletions: 0 };
        return { file: fd.file, status: fd.status, ...counts };
      }),
    [diff, parsedByFile],
  );

  const tree = useMemo(() => buildFileTree(stats), [stats]);
  const rows = useMemo(() => flattenTree(tree, collapsedDirs), [tree, collapsedDirs]);
  const totals = useMemo(
    () =>
      stats.reduce(
        (acc, s) => ({
          additions: acc.additions + s.additions,
          deletions: acc.deletions + s.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [stats],
  );

  const byFile = useMemo(() => {
    const map = new Map<string, FleetFileDiff>();
    for (const fd of diff ?? []) map.set(fd.file, fd);
    return map;
  }, [diff]);

  const toggleDir = (path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleFile = (path: string) => {
    setOpenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const allOpen = diff !== null && diff.length > 0 && openFiles.size === diff.length;
  const toggleAll = () => {
    setOpenFiles(allOpen ? new Set() : new Set((diff ?? []).map((fd) => fd.file)));
  };

  const count = diff?.length ?? 0;

  return (
    // NO overflow-hidden here: it would become the sticky header's containing scroll ancestor and
    // silently disable the stick against the conversation's scroller — corners round per-edge
    // on the header/body instead.
    <section className="mt-2 rounded-lg border border-border/60 bg-card/40">
      {/* Sticky within the conversation's scroll container, so a long expanded diff keeps its
          summary (and Collapse all) in reach — t3's sticky header, minus its gradient seam. */}
      <header className="sticky top-0 z-10 flex min-h-8 items-center gap-2 rounded-t-lg border-b border-border/50 bg-background/95 px-2.5 py-1 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setCardCollapsed(unitKey, !collapsed)}
          aria-expanded={!collapsed}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 text-[11.5px] font-medium text-foreground/85 hover:text-foreground"
        >
          <HugeiconsIcon
            icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
            size={12}
            strokeWidth={2}
          />
          Changed files{count > 0 ? ` (${count})` : ""}
        </button>
        <DiffStatLabel
          additions={totals.additions}
          deletions={totals.deletions}
          layout="inline"
        />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {!collapsed && count > 0 && (
            <>
              {openFiles.size > 0 && (
                <DiffViewToggle view={view} onView={setView} wrap={wrap} onWrap={setWrap} />
              )}
              <button
                type="button"
                onClick={toggleAll}
                className="cursor-pointer text-[10.5px] font-medium text-muted-foreground hover:text-foreground"
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            </>
          )}
        </div>
      </header>

      {!collapsed && (
        <div className="flex flex-col rounded-b-lg px-1.5 py-1.5">
          {error ? (
            <div className="px-1 py-0.5 text-[11px] text-destructive">{error}</div>
          ) : diff === null ? (
            <div className="flex flex-col gap-1.5 px-1 py-0.5" aria-hidden>
              <Skeleton className="h-4 w-1/3 rounded" />
              <Skeleton className="h-4 w-2/3 rounded" />
              <Skeleton className="h-4 w-1/2 rounded" />
            </div>
          ) : diff.length === 0 ? (
            <div className="px-1 py-0.5 text-[11px] text-muted-foreground/70">
              No uncommitted changes in the worktree.
            </div>
          ) : (
            rows.map(({ node, depth }) => {
              if (node.kind === "dir") {
                const isCollapsed = collapsedDirs.has(node.path);
                return (
                  <button
                    key={`dir:${node.path}`}
                    type="button"
                    onClick={() => toggleDir(node.path)}
                    aria-expanded={!isCollapsed}
                    style={{ paddingLeft: depth * 14 + 4 }}
                    className="flex min-h-6 w-full cursor-pointer items-center gap-1.5 rounded text-left text-[11.5px] text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  >
                    <HugeiconsIcon
                      icon={isCollapsed ? ArrowRight01Icon : ArrowDown01Icon}
                      size={11}
                      strokeWidth={2}
                      className="shrink-0"
                    />
                    <HugeiconsIcon
                      icon={Folder01Icon}
                      size={12}
                      strokeWidth={1.75}
                      className="shrink-0 text-muted-foreground/70"
                    />
                    <span className="min-w-0 flex-1 truncate">{node.name}</span>
                    <DiffStatLabel
                      additions={node.additions}
                      deletions={node.deletions}
                      className="pr-1"
                    />
                  </button>
                );
              }
              const open = openFiles.has(node.path);
              const fd = byFile.get(node.path);
              const parsed = parsedByFile.get(node.path);
              return (
                <div key={`file:${node.path}`} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleFile(node.path)}
                    aria-expanded={open}
                    title={open ? "Hide diff" : "View diff"}
                    style={{ paddingLeft: depth * 14 + 4 }}
                    className={cn(
                      "flex min-h-6 w-full cursor-pointer items-center gap-1.5 rounded text-left text-[11.5px] hover:bg-accent/60",
                      open ? "text-foreground" : "text-foreground/80",
                    )}
                  >
                    <HugeiconsIcon
                      icon={File01Icon}
                      size={12}
                      strokeWidth={1.75}
                      className="ml-[13px] shrink-0 text-muted-foreground/70"
                    />
                    <span className="min-w-0 flex-1 truncate">{node.name}</span>
                    {node.stat.status === "A" && (
                      <span className="shrink-0 text-[10px] font-medium text-success/80">new</span>
                    )}
                    {node.stat.status === "D" && (
                      <span className="shrink-0 text-[10px] font-medium text-destructive/80">
                        deleted
                      </span>
                    )}
                    <DiffStatLabel
                      additions={node.stat.additions}
                      deletions={node.stat.deletions}
                      className="pr-1"
                    />
                  </button>
                  {open && fd && parsed && (
                    // Full card width — a nested diff at tree indentation would squeeze the gutter.
                    <div className="my-1">
                      <DiffFile
                        file={fd.file}
                        status={fd.status}
                        parsed={parsed}
                        raw={fd.diff}
                        view={view}
                        wrap={wrap}
                        onQuote={onQuote}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
