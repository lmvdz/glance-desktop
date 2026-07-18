// Pure diff model for the t3-grade diff surface (t3-face concern 10, escape-hatch:
// no @pierre/diffs — it overshoots the 1500 KB client-JS budget by ~1.9 MB, see PR).
// One structured line model feeds one renderer for both the fleet IntervenePane
// (daemon-served per-file unified-diff strings) and the AI PlanDiffReview
// (original→proposed content pairs). Kept separate from the component so the
// parsing / LCS / split transform are unit-testable without a DOM.

/** One rendered row of a diff. `text` is the content WITHOUT the +/-/space
 *  prefix (for add/del/context) or the raw `@@` header (for hunk). */
export interface DiffLine {
  kind: "add" | "del" | "context" | "hunk";
  text: string;
  /** 1-based line number in the old file (del + context). */
  oldNo?: number;
  /** 1-based line number in the new file (add + context). */
  newNo?: number;
}

export interface ParsedDiff {
  lines: DiffLine[];
  /** false → input didn't look like a diff; caller renders raw monospace text. */
  ok: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a unified-diff string (one file's worth, as the daemon serves) into a
 * flat line model with resolved line numbers. File-meta lines (diff/index/+++/
 * ---/"\ No newline") are dropped. Returns ok:false for input that carries no
 * hunk header and no +/- lines, so the host can fall back to raw text.
 */
export function parseUnifiedDiff(diff: string): ParsedDiff {
  const raw = diff.split("\n");
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let sawHunk = false;

  for (const line of raw) {
    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      sawHunk = true;
      lines.push({ kind: "hunk", text: line });
      continue;
    }
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("\\ ")
    ) {
      continue; // file meta — not shown as a diff row
    }
    if (line.startsWith("+")) {
      lines.push({ kind: "add", text: line.slice(1), newNo });
      newNo++;
      continue;
    }
    if (line.startsWith("-")) {
      lines.push({ kind: "del", text: line.slice(1), oldNo });
      oldNo++;
      continue;
    }
    const text = line.startsWith(" ") ? line.slice(1) : line;
    lines.push({ kind: "context", text, oldNo, newNo });
    oldNo++;
    newNo++;
  }

  const ok =
    sawHunk || lines.some((l) => l.kind === "add" || l.kind === "del");
  return { lines, ok };
}

/**
 * Line-level diff of two full-file strings by trimming the common prefix and
 * suffix and treating the divergent middle as a delete-then-add block —
 * interleaved context/del/add rows the naive set-membership preview couldn't
 * produce. This is exact for the localized single-region edits a plan-apply
 * queue almost always contains, and far smaller than a full LCS table (which
 * the fork's client-JS budget can't afford — concern 10 escape-hatch).
 */
export function lineDiff(before: string, after: string): ParsedDiff {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");

  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let hiA = a.length;
  let hiB = b.length;
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) {
    hiA--;
    hiB--;
  }

  const lines: DiffLine[] = [];
  for (let i = 0; i < lo; i++)
    lines.push({ kind: "context", text: a[i], oldNo: i + 1, newNo: i + 1 });
  for (let i = lo; i < hiA; i++)
    lines.push({ kind: "del", text: a[i], oldNo: i + 1 });
  for (let j = lo; j < hiB; j++)
    lines.push({ kind: "add", text: b[j], newNo: j + 1 });
  for (let i = hiA; i < a.length; i++)
    lines.push({
      kind: "context",
      text: a[i],
      oldNo: i + 1,
      newNo: i - hiA + hiB + 1,
    });

  return { lines, ok: true };
}

export interface SplitCell {
  line: DiffLine;
  /** Index into the flat `lines` array (selection key). */
  idx: number;
}

export interface SplitRow {
  left?: SplitCell;
  right?: SplitCell;
  /** Present when the row is a hunk header spanning both columns. */
  hunk?: string;
}

/**
 * Transform the flat unified line model into side-by-side rows: consecutive
 * dels pair with consecutive adds (left/right), leftovers fall to one side,
 * context aligns both, and a hunk header spans the full width.
 */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: SplitCell[] = [];
  let adds: SplitCell[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) rows.push({ left: dels[k], right: adds[k] });
    dels = [];
    adds = [];
  };
  lines.forEach((line, idx) => {
    if (line.kind === "hunk") {
      flush();
      rows.push({ hunk: line.text });
      return;
    }
    if (line.kind === "del") {
      dels.push({ line, idx });
      return;
    }
    if (line.kind === "add") {
      adds.push({ line, idx });
      return;
    }
    flush();
    rows.push({ left: { line, idx }, right: { line, idx } });
  });
  flush();
  return rows;
}

/** Prefix a diff line the way a unified diff renders it (for copy / quoting). */
export function linePrefix(kind: DiffLine["kind"]): string {
  return kind === "add" ? "+" : kind === "del" ? "-" : " ";
}
