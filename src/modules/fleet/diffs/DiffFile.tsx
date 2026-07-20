import { useMemo, useRef, useState } from "react";
import {
  type ParsedDiff,
  type SplitCell,
  linePrefix,
  toSplitRows,
} from "./parseDiff";

export type DiffViewMode = "unified" | "split";

/** A line-selection lifted out of the diff, ready to seed a review comment. */
export interface QuotePayload {
  file: string;
  /** e.g. `src/foo.ts:12-15` — the file and the selected new-file line range. */
  label: string;
  /** The selected lines, prefixed (+/-/space), newline-joined. */
  text: string;
}

/**
 * One file's diff, rendered t3-grade: unified or split, optional soft-wrap,
 * gutter line numbers, sticky hunk headers, and (when `onQuote` is wired)
 * click / shift-click line selection that lifts the picked lines into a review
 * comment. Parse-failure or non-diff input falls back to raw monospace text and
 * never throws. All color/layout lives in t3face.css so it repaints under every
 * theme (concern 10, escape-hatch — no @pierre/diffs).
 */
export function DiffFile({
  file,
  status,
  parsed,
  raw,
  view,
  wrap,
  onQuote,
}: {
  file: string;
  status?: string;
  parsed: ParsedDiff;
  /** Original text, shown verbatim when the input didn't parse as a diff. */
  raw?: string;
  view: DiffViewMode;
  wrap: boolean;
  onQuote?: (p: QuotePayload) => void;
}) {
  const [sel, setSel] = useState<ReadonlySet<number>>(() => new Set());
  const anchor = useRef<number | null>(null);

  const splitRows = useMemo(
    () => (view === "split" ? toSplitRows(parsed.lines) : []),
    [view, parsed.lines],
  );
  const selectableIdx = useMemo(
    () =>
      parsed.lines.reduce<number[]>((acc, l, i) => {
        if (l.kind !== "hunk") acc.push(i);
        return acc;
      }, []),
    [parsed.lines],
  );

  const changed = parsed.lines.some(
    (l) => l.kind === "add" || l.kind === "del",
  );
  const clickable = !!onQuote;

  const select = (idx: number, shift: boolean) => {
    if (!onQuote) return;
    setSel((prev) => {
      if (shift && anchor.current !== null) {
        const lo = Math.min(anchor.current, idx);
        const hi = Math.max(anchor.current, idx);
        return new Set(selectableIdx.filter((i) => i >= lo && i <= hi));
      }
      anchor.current = idx;
      if (prev.size === 1 && prev.has(idx)) return new Set();
      return new Set([idx]);
    });
  };

  const quote = () => {
    if (!onQuote || sel.size === 0) return;
    const idxs = [...sel].sort((a, b) => a - b);
    const picked = idxs.map((i) => parsed.lines[i]);
    const text = picked.map((l) => linePrefix(l.kind) + l.text).join("\n");
    const nums = picked
      .map((l) => l.newNo ?? l.oldNo)
      .filter((n): n is number => typeof n === "number");
    const label = nums.length
      ? `${file}:${nums[0]}${nums.length > 1 ? `-${nums[nums.length - 1]}` : ""}`
      : file;
    onQuote({ file, label, text });
    setSel(new Set());
    anchor.current = null;
  };

  return (
    <div className="diff-file">
      <div className="diff-file-header">
        <span className="diff-file-name" title={file}>
          {file}
        </span>
        {sel.size > 0 && onQuote ? (
          <button type="button" className="diff-comment-btn" onClick={quote}>
            Comment ({sel.size})
          </button>
        ) : status ? (
          <span className="diff-file-status">{status}</span>
        ) : null}
      </div>

      {!parsed.ok ? (
        <pre className="diff-raw">{raw ?? parsed.lines.map((l) => l.text).join("\n")}</pre>
      ) : !changed ? (
        <div className="diff-empty">no line-level changes</div>
      ) : view === "split" ? (
        <div className="diff-body diff-split" data-wrap={wrap}>
          {splitRows.map((r, k) =>
            r.hunk !== undefined ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and static
              <div key={k} className="diff-hunk">
                {r.hunk}
              </div>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and static
              <div key={k} className="diff-split-row">
                <SplitHalf
                  cell={r.left}
                  clickable={clickable}
                  selected={sel}
                  onSelect={select}
                />
                <SplitHalf
                  cell={r.right}
                  clickable={clickable}
                  selected={sel}
                  onSelect={select}
                />
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="diff-body" data-wrap={wrap}>
          {parsed.lines.map((l, idx) =>
            l.kind === "hunk" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and static
              <div key={idx} className="diff-hunk">
                {l.text}
              </div>
            ) : (
              // biome-ignore lint/a11y/noStaticElementInteractions: diff line-selection is mouse-driven by design (GitHub/pierre idiom); per-line tab focus on hundreds of rows is worse UX — keyboard arrow-nav is deferred to the concern-13 a11y audit
              // biome-ignore lint/a11y/useKeyWithClickEvents: see above — rows are intentionally not individually focusable
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and static
                key={idx}
                className="diff-row"
                data-kind={l.kind}
                data-clickable={clickable || undefined}
                data-selected={sel.has(idx) || undefined}
                onClick={
                  clickable ? (e) => select(idx, e.shiftKey) : undefined
                }
              >
                <span className="diff-gutter">{l.oldNo ?? ""}</span>
                <span className="diff-gutter">{l.newNo ?? ""}</span>
                <span className="diff-sign">{linePrefix(l.kind)}</span>
                <span className="diff-text">{l.text || " "}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function SplitHalf({
  cell,
  clickable,
  selected,
  onSelect,
}: {
  cell: SplitCell | undefined;
  clickable: boolean;
  selected: ReadonlySet<number>;
  onSelect: (idx: number, shift: boolean) => void;
}) {
  if (!cell) return <div className="diff-cell" data-kind="empty" />;
  const { line, idx } = cell;
  const gutterNo = line.kind === "add" ? line.newNo : line.oldNo;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: diff line-selection is mouse-driven by design (GitHub/pierre idiom); per-line tab focus is worse UX — keyboard arrow-nav deferred to the concern-13 a11y audit
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above — cells are intentionally not individually focusable
    <div
      className="diff-cell"
      data-kind={line.kind}
      data-clickable={clickable || undefined}
      data-selected={selected.has(idx) || undefined}
      onClick={clickable ? (e) => onSelect(idx, e.shiftKey) : undefined}
    >
      <span className="diff-gutter">{gutterNo ?? ""}</span>
      <span className="diff-sign">{linePrefix(line.kind)}</span>
      <span className="diff-text">{line.text || " "}</span>
    </div>
  );
}
