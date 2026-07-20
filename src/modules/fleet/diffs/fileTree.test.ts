import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  countDiffStats,
  type FileChangeStat,
  type FileTreeDir,
  flattenTree,
} from "./fileTree";
import { parseUnifiedDiff } from "./parseDiff";

const f = (file: string, additions = 1, deletions = 0): FileChangeStat => ({
  file,
  additions,
  deletions,
  status: "M",
});

describe("countDiffStats", () => {
  it("counts add/del rows from a parsed unified diff", () => {
    const parsed = parseUnifiedDiff(
      "@@ -1,3 +1,3 @@\n context\n-old\n+new\n+extra\n",
    );
    expect(countDiffStats(parsed)).toEqual({ additions: 2, deletions: 1 });
  });
});

describe("buildFileTree — compaction + aggregation (H3)", () => {
  it("compacts a single-child directory chain into one node", () => {
    const tree = buildFileTree([f("src/modules/fleet/diffs/DiffFile.tsx", 3, 1)]);
    expect(tree).toHaveLength(1);
    const dir = tree[0] as FileTreeDir;
    expect(dir.kind).toBe("dir");
    expect(dir.name).toBe("src/modules/fleet/diffs");
    expect(dir.additions).toBe(3);
    expect(dir.deletions).toBe(1);
    expect(dir.children).toHaveLength(1);
    expect(dir.children[0]).toMatchObject({ kind: "file", name: "DiffFile.tsx" });
  });

  it("keeps branching directories separate and aggregates stats up the tree", () => {
    const tree = buildFileTree([
      f("src/a/one.ts", 2, 0),
      f("src/b/two.ts", 0, 5),
      f("src/root.ts", 1, 1),
    ]);
    const src = tree[0] as FileTreeDir;
    expect(src.name).toBe("src");
    expect(src.additions).toBe(3);
    expect(src.deletions).toBe(6);
    // dirs sort before files, alphabetically
    expect(src.children.map((c) => c.name)).toEqual(["a", "b", "root.ts"]);
    const a = src.children[0] as FileTreeDir;
    expect(a.additions).toBe(2);
  });

  it("root-level files sit beside top-level directories", () => {
    const tree = buildFileTree([f("README.md"), f("src/x.ts")]);
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(["dir:src", "file:README.md"]);
  });

  it("compaction stops at a directory that owns a file", () => {
    const tree = buildFileTree([f("a/b/keep.ts"), f("a/b/c/deep.ts")]);
    const ab = tree[0] as FileTreeDir;
    expect(ab.name).toBe("a/b");
    expect(ab.children.map((c) => `${c.kind}:${c.name}`)).toEqual(["dir:c", "file:keep.ts"]);
  });
});

describe("flattenTree", () => {
  const files = [f("src/a/one.ts"), f("src/a/two.ts"), f("src/top.ts")];

  it("emits depth-annotated rows in tree order", () => {
    const rows = flattenTree(buildFileTree(files), new Set());
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual([
      "0:src",
      "1:a",
      "2:one.ts",
      "2:two.ts",
      "1:top.ts",
    ]);
  });

  it("skips the children of a collapsed directory", () => {
    const tree = buildFileTree(files);
    const src = tree[0] as FileTreeDir;
    const a = src.children[0] as FileTreeDir;
    const rows = flattenTree(tree, new Set([a.path]));
    expect(rows.map((r) => r.node.name)).toEqual(["src", "a", "top.ts"]);
  });
});
