import { describe, expect, it } from "vitest";
import type { TranscriptTool } from "../lib/fleetTranscript";
import { presentTool } from "./toolPresenter";

function tool(over: Partial<TranscriptTool> & { name: string }): TranscriptTool {
  return { ...over };
}

describe("presentTool", () => {
  // The headline fix: the exact `bash {"command":"tsc …"}` wall Lars saw becomes prose.
  it("renders a bash command as 'Ran <command>', never the JSON envelope", () => {
    const p = presentTool(tool({ name: "bash", args: { command: "tsc --noEmit" } }));
    expect(p).toEqual({ verb: "Ran", subject: "tsc --noEmit", detail: undefined });
    // hard guard: no JSON braces leaked into the subject
    expect(p.subject).not.toContain("{");
    expect(p.subject).not.toContain('"command"');
  });

  // ── grounded in REAL captured transcript arg shapes (~/.glance org transcripts) ──
  it("bash with cwd/timeout (real shape) surfaces only the command, cwd as detail", () => {
    const p = presentTool(
      tool({
        name: "bash",
        args: {
          command: "bun test tests/harness-hooks.test.ts -t 'cwd with a doublequote'",
          cwd: ".",
          timeout: 60,
        },
      }),
    );
    expect(p.verb).toBe("Ran");
    expect(p.subject).toBe("bun test tests/harness-hooks.test.ts -t 'cwd with a doublequote'");
    expect(p.detail).toBeUndefined(); // cwd "." is not worth showing
  });

  it("bash in a non-root cwd shows it as calm detail", () => {
    const p = presentTool(tool({ name: "bash", args: { command: "cargo build", cwd: "packages/dagon" } }));
    expect(p).toEqual({ verb: "Ran", subject: "cargo build", detail: "in packages/dagon" });
  });

  it("read uses the real `path` key → 'Read <path>'", () => {
    const p = presentTool(tool({ name: "read", args: { path: "skill://frontend-design-guidelines" } }));
    expect(p).toEqual({ verb: "Read", subject: "skill://frontend-design-guidelines" });
  });

  it("grep (real shape) → 'Searched <pattern>'", () => {
    const p = presentTool(
      tool({
        name: "grep",
        args: { pattern: "function installHarnessHooks|installHarnessHooks", path: "src tests", case: true },
      }),
    );
    expect(p).toEqual({ verb: "Searched", subject: "function installHarnessHooks|installHarnessHooks" });
  });

  it("glob (real shape) → 'Searched' on the path when no pattern", () => {
    const p = presentTool(
      tool({ name: "glob", args: { path: "package.json;src;webapp;plans", hidden: true, limit: 50 } }),
    );
    expect(p).toEqual({ verb: "Searched", subject: "package.json;src;webapp;plans" });
  });

  it("search_tool_bm25 (real shape) → 'Searched <query>'", () => {
    const p = presentTool(
      tool({ name: "search_tool_bm25", args: { query: "codegraph_search codegraph_context", limit: 5 } }),
    );
    expect(p).toEqual({ verb: "Searched", subject: "codegraph_search codegraph_context" });
  });

  it("todo (real shape) → 'Updated the plan' with no noisy subject", () => {
    const p = presentTool(tool({ name: "todo", args: { op: "init", list: [{ phase: "Fix", items: ["x"] }] } }));
    expect(p).toEqual({ verb: "Updated the plan", subject: "" });
  });

  // ── file-write vocabulary (both harness families) ──
  it("write → 'Wrote <path>' (lowercase path key)", () => {
    expect(presentTool(tool({ name: "write", args: { path: "src/foo.ts" } }))).toEqual({
      verb: "Wrote",
      subject: "src/foo.ts",
    });
  });

  it("edit and ast_edit → 'Edited <path>'", () => {
    expect(presentTool(tool({ name: "edit", args: { path: "src/a.ts" } }))).toEqual({
      verb: "Edited",
      subject: "src/a.ts",
    });
    expect(presentTool(tool({ name: "ast_edit", args: { path: "src/b.ts" } })).verb).toBe("Edited");
  });

  // ── Claude-Code capitalized vocabulary + file_path key ──
  it("accepts capitalized Claude-Code names and the file_path key", () => {
    expect(presentTool(tool({ name: "Read", args: { file_path: "/abs/x.ts" } }))).toEqual({
      verb: "Read",
      subject: "/abs/x.ts",
    });
    expect(presentTool(tool({ name: "Bash", args: { command: "ls -la" } })).verb).toBe("Ran");
    expect(presentTool(tool({ name: "Grep", args: { pattern: "TODO" } }))).toEqual({
      verb: "Searched",
      subject: "TODO",
    });
  });

  // ── argsText-only entries (args not carried, only serialized) ──
  it("parses argsText when structured args are absent", () => {
    const p = presentTool(tool({ name: "bash", argsText: '{ "command": "git status" }' }));
    expect(p).toEqual({ verb: "Ran", subject: "git status", detail: undefined });
  });

  // ── MCP tools ──
  it("humanizes mcp__ tools into '<Server> · <action>'", () => {
    expect(presentTool(tool({ name: "mcp__plane_list_work_items" }))).toEqual({
      verb: "Plane",
      subject: "list work items",
    });
    expect(presentTool(tool({ name: "mcp__codegraph_search", args: { query: "x" } })).verb).toBe(
      "Codegraph",
    );
  });

  // ── web + fetch ──
  it("web_search and fetch read query/url", () => {
    expect(presentTool(tool({ name: "web_search", args: { query: "effect v4 layers" } }))).toEqual({
      verb: "Searched the web",
      subject: "effect v4 layers",
    });
    expect(presentTool(tool({ name: "fetch", args: { url: "https://x.dev" } }))).toEqual({
      verb: "Fetched",
      subject: "https://x.dev",
    });
  });

  // ── unknown tools degrade gracefully, still never a JSON wall as the verb ──
  it("humanizes an unknown tool name and previews an arg, no JSON envelope", () => {
    const p = presentTool(tool({ name: "some_new_tool", args: { input: "hello there" } }));
    expect(p.verb).toBe("Some new tool");
    expect(p.subject).toBe("hello there");
    expect(p.subject).not.toContain("{");
  });

  it("unknown tool with no usable string arg yields an empty subject, never throws", () => {
    // Non-string scalars aren't worth a noisy preview — a calm empty subject beats a bare "3".
    expect(presentTool(tool({ name: "mystery", args: { flag: true, n: 3 } }))).toEqual({
      verb: "Mystery",
      subject: "",
    });
    expect(presentTool(tool({ name: "mystery" }))).toEqual({ verb: "Mystery", subject: "" });
  });

  // ── robustness: never throw, always one line ──
  it("collapses a multi-line command to a single readable line", () => {
    const p = presentTool(tool({ name: "bash", args: { command: "set -e\ntsc --noEmit\nvitest run" } }));
    expect(p.subject).toBe("set -e tsc --noEmit vitest run");
    expect(p.subject).not.toContain("\n");
  });

  it("truncates a very long subject with an ellipsis", () => {
    const long = "a".repeat(500);
    const p = presentTool(tool({ name: "bash", args: { command: long } }));
    expect(p.subject.length).toBeLessThanOrEqual(140);
    expect(p.subject.endsWith("…")).toBe(true);
  });

  it("joins an argv-array command", () => {
    const p = presentTool(tool({ name: "bash", args: { command: ["git", "commit", "-m", "wip"] } }));
    expect(p).toEqual({ verb: "Ran", subject: "git commit -m wip", detail: undefined });
  });

  it("stage and unknown ACP-kind tools leave subject empty for the renderer to backfill", () => {
    expect(presentTool(tool({ name: "stage" }))).toEqual({ verb: "Stage", subject: "" });
    // ACP 'execute'/'read' kinds with no args → verb resolves, subject empty
    expect(presentTool(tool({ name: "execute" }))).toEqual({ verb: "Ran", subject: "" });
    expect(presentTool(tool({ name: "read" }))).toEqual({ verb: "Read", subject: "" });
  });
});
