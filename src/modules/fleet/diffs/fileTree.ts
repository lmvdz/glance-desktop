// Path tree + diffstat model for the Changed-files card (hub-shell H3, r3 borrow 1 —
// plans/research-t3code round 3). Ports the *shape* of t3code's `buildTurnDiffTree`
// (apps/web/src/lib/turnDiffTree.ts, © 2026 T3 Tools Inc., MIT License): group files by path
// segment, aggregate additions/deletions up the tree, and compact single-child directory chains
// (`a/b/c/file` with no siblings renders as one "a/b/c" row, not three nested folders). Pure and
// DOM-free so the tree/stat math is unit-testable.

import type { DiffLine, ParsedDiff } from "./parseDiff";

export interface FileChangeStat {
  /** Repo-relative path as the daemon reports it. */
  file: string;
  additions: number;
  deletions: number;
  /** Daemon status letter (M/A/D/…), passed through for row styling. */
  status?: string;
}

/** Count +/− rows out of an already-parsed per-file diff. */
export function countDiffStats(parsed: ParsedDiff): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of parsed.lines as DiffLine[]) {
    if (line.kind === "add") additions += 1;
    else if (line.kind === "del") deletions += 1;
  }
  return { additions, deletions };
}

export interface FileTreeDir {
  kind: "dir";
  /** Display name — a compacted chain renders as "a/b/c". */
  name: string;
  /** Full path of the (possibly compacted) directory. */
  path: string;
  children: FileTreeNode[];
  additions: number;
  deletions: number;
}

export interface FileTreeLeaf {
  kind: "file";
  name: string;
  path: string;
  stat: FileChangeStat;
}

export type FileTreeNode = FileTreeDir | FileTreeLeaf;

interface MutableDir {
  name: string;
  path: string;
  dirs: Map<string, MutableDir>;
  files: FileTreeLeaf[];
}

function newDir(name: string, path: string): MutableDir {
  return { name, path, dirs: new Map(), files: [] };
}

function finalize(dir: MutableDir): FileTreeDir {
  const children: FileTreeNode[] = [
    ...[...dir.dirs.values()]
      .map(finalize)
      .map(compactDirectoryNode)
      .sort((a, b) => a.name.localeCompare(b.name)),
    ...dir.files.sort((a, b) => a.name.localeCompare(b.name)),
  ];
  let additions = 0;
  let deletions = 0;
  for (const child of children) {
    if (child.kind === "dir") {
      additions += child.additions;
      deletions += child.deletions;
    } else {
      additions += child.stat.additions;
      deletions += child.stat.deletions;
    }
  }
  return { kind: "dir", name: dir.name, path: dir.path, children, additions, deletions };
}

/** `a/` containing only `b/` (no files) merges into one "a/b" node, recursively. */
function compactDirectoryNode(dir: FileTreeDir): FileTreeDir {
  if (dir.children.length === 1 && dir.children[0].kind === "dir") {
    const only = dir.children[0];
    return compactDirectoryNode({
      ...only,
      name: `${dir.name}/${only.name}`,
    });
  }
  return dir;
}

/** Build the (compacted, stat-aggregated, sorted dirs-then-files) tree for a set of changed files. */
export function buildFileTree(files: FileChangeStat[]): FileTreeNode[] {
  const root = newDir("", "");
  for (const stat of files) {
    const segments = stat.file.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let dir = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      const path = dir.path ? `${dir.path}/${seg}` : seg;
      let next = dir.dirs.get(seg);
      if (!next) {
        next = newDir(seg, path);
        dir.dirs.set(seg, next);
      }
      dir = next;
    }
    const name = segments[segments.length - 1];
    dir.files.push({ kind: "file", name, path: stat.file, stat });
  }
  return finalize(root).children;
}

export interface FlatTreeRow {
  node: FileTreeNode;
  depth: number;
}

/** Depth-first flatten for rendering; children of a collapsed directory (by path) are skipped. */
export function flattenTree(
  nodes: FileTreeNode[],
  collapsedDirs: ReadonlySet<string>,
  depth = 0,
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === "dir" && !collapsedDirs.has(node.path)) {
      rows.push(...flattenTree(node.children, collapsedDirs, depth + 1));
    }
  }
  return rows;
}
