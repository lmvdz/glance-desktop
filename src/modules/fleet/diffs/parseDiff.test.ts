import { describe, expect, it } from "vitest";
import {
  lineDiff,
  linePrefix,
  parseUnifiedDiff,
  toSplitRows,
} from "./parseDiff";

describe("parseUnifiedDiff", () => {
  it("classifies rows, drops file meta, and resolves line numbers", () => {
    const diff = [
      "diff --git a/x.ts b/x.ts",
      "index abc..def 100644",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,3 +1,4 @@",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      "+const c = 4;",
      " const d = 5;",
    ].join("\n");
    const { lines, ok } = parseUnifiedDiff(diff);
    expect(ok).toBe(true);
    // meta lines (diff/index/---/+++) are dropped
    expect(lines.map((l) => l.kind)).toEqual([
      "hunk",
      "context",
      "del",
      "add",
      "add",
      "context",
    ]);
    // context line 1 carries both old + new = 1
    expect(lines[1]).toMatchObject({ oldNo: 1, newNo: 1, text: "const a = 1;" });
    // deletion advances only the old counter
    expect(lines[2]).toMatchObject({ kind: "del", oldNo: 2, text: "const b = 2;" });
    // additions advance only the new counter
    expect(lines[3]).toMatchObject({ kind: "add", newNo: 2, text: "const b = 3;" });
    expect(lines[4]).toMatchObject({ kind: "add", newNo: 3, text: "const c = 4;" });
    // trailing context: old skipped the deletion, new skipped the additions
    expect(lines[5]).toMatchObject({ oldNo: 3, newNo: 4, text: "const d = 5;" });
  });

  it("marks non-diff input as not-ok so the host can fall back to raw text", () => {
    expect(parseUnifiedDiff("just some prose\nnot a diff").ok).toBe(false);
    expect(parseUnifiedDiff("").ok).toBe(false);
  });

  it("accepts +/- content even without a hunk header", () => {
    const { ok, lines } = parseUnifiedDiff("+added\n-removed");
    expect(ok).toBe(true);
    expect(lines.map((l) => l.kind)).toEqual(["add", "del"]);
  });
});

describe("lineDiff — common-prefix/suffix diff of two file strings", () => {
  it("keeps the common head/tail as context and replaces the middle", () => {
    const { lines } = lineDiff("a\nb\nc", "a\nX\nc");
    expect(lines.map((l) => `${linePrefix(l.kind)}${l.text}`)).toEqual([
      " a",
      "-b",
      "+X",
      " c",
    ]);
    // line numbers resolve on both sides of the change
    expect(lines[3]).toMatchObject({ oldNo: 3, newNo: 3 });
  });

  it("returns all-context (no changes) for identical input", () => {
    const { lines } = lineDiff("x\ny", "x\ny");
    expect(lines.every((l) => l.kind === "context")).toBe(true);
    expect(lines).toHaveLength(2);
  });

  it("treats an empty before as pure additions (new file)", () => {
    const { lines } = lineDiff("", "one\ntwo");
    expect(lines.map((l) => l.kind)).toEqual(["add", "add"]);
    expect(lines.map((l) => l.newNo)).toEqual([1, 2]);
  });

  it("shows a pure insertion as adds bracketed by unchanged context", () => {
    const { lines } = lineDiff("a\nb", "a\nX\nb");
    expect(lines.map((l) => `${linePrefix(l.kind)}${l.text}`)).toEqual([
      " a",
      "+X",
      " b",
    ]);
  });
});

describe("toSplitRows — unified → side-by-side", () => {
  it("pairs consecutive dels with adds and aligns context on both sides", () => {
    const { lines } = parseUnifiedDiff(
      ["@@ -1,2 +1,2 @@", " ctx", "-old", "+new"].join("\n"),
    );
    const rows = toSplitRows(lines);
    expect(rows[0]).toEqual({ hunk: "@@ -1,2 +1,2 @@" });
    // context spans both columns (same line object)
    expect(rows[1].left?.line.text).toBe("ctx");
    expect(rows[1].right?.line.text).toBe("ctx");
    // del/add paired left/right
    expect(rows[2].left?.line.kind).toBe("del");
    expect(rows[2].right?.line.kind).toBe("add");
  });

  it("leaves an empty half when dels and adds are unbalanced", () => {
    const { lines } = parseUnifiedDiff(
      ["@@ -1,2 +1,1 @@", "-a", "-b", "+c"].join("\n"),
    );
    const rows = toSplitRows(lines).filter((r) => !r.hunk);
    expect(rows).toHaveLength(2);
    expect(rows[0].left?.line.text).toBe("a");
    expect(rows[0].right?.line.text).toBe("c");
    expect(rows[1].left?.line.text).toBe("b");
    expect(rows[1].right).toBeUndefined(); // no matching add
  });

  it("carries the flat-array index on each cell for selection", () => {
    const { lines } = parseUnifiedDiff(["@@ -1 +1 @@", "-a", "+b"].join("\n"));
    const rows = toSplitRows(lines).filter((r) => !r.hunk);
    expect(rows[0].left?.idx).toBe(1); // lines[0] is the hunk, lines[1] the del
    expect(rows[0].right?.idx).toBe(2);
  });
});

describe("linePrefix", () => {
  it("maps kinds to their unified-diff sign", () => {
    expect(linePrefix("add")).toBe("+");
    expect(linePrefix("del")).toBe("-");
    expect(linePrefix("context")).toBe(" ");
    expect(linePrefix("hunk")).toBe(" ");
  });
});
