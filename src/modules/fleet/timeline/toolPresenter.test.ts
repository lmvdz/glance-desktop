import { describe, expect, it } from "vitest";
import type { TranscriptTool } from "../lib/fleetTranscript";
import { presentTool, resultSuggestsFailure, unwrapShellCommand } from "./toolPresenter";

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

describe("unwrapShellCommand — shell-wrapper unwrapping (r3 borrow 2)", () => {
  it("unwraps bash -lc with double quotes", () => {
    expect(unwrapShellCommand('bash -lc "tsc --noEmit"')).toBe("tsc --noEmit");
  });
  it("unwraps bash -c with single quotes", () => {
    expect(unwrapShellCommand("bash -c 'git status --short'")).toBe("git status --short");
  });
  it("unwraps split flag clusters (-l -c) and unquoted commands", () => {
    expect(unwrapShellCommand("sh -l -c pnpm test")).toBe("pnpm test");
  });
  it("unwraps pwsh -Command and cmd /c", () => {
    expect(unwrapShellCommand('pwsh -NoProfile -Command "Get-ChildItem"')).toBe("Get-ChildItem");
    expect(unwrapShellCommand("cmd.exe /C dir")).toBe("dir");
  });
  it("unwraps one nested layer, capped", () => {
    expect(unwrapShellCommand(`bash -lc "sh -c 'echo hi'"`)).toBe("echo hi");
  });
  it("leaves a bare bash invocation without -c alone (interactive/login shells)", () => {
    expect(unwrapShellCommand("bash -l")).toBe("bash -l");
    expect(unwrapShellCommand("bash script.sh")).toBe("bash script.sh");
  });
  it("leaves ordinary commands untouched", () => {
    expect(unwrapShellCommand("cargo build --release")).toBe("cargo build --release");
  });
  it("presentTool applies the unwrap so the row reads the inner command", () => {
    const p = presentTool(tool({ name: "bash", args: { command: 'bash -lc "tsc --noEmit"' } }));
    expect(p.subject).toBe("tsc --noEmit");
  });
});

describe("resultSuggestsFailure — command-family failure heuristic (r3 borrow 2)", () => {
  it("flags 'command not found' / ENOENT / nonzero exit in the result tail", () => {
    expect(resultSuggestsFailure(tool({ name: "bash", resultText: "zsh: command not found: tscc" }))).toBe(true);
    expect(resultSuggestsFailure(tool({ name: "bash", resultText: "spawn tsc ENOENT" }))).toBe(true);
    expect(resultSuggestsFailure(tool({ name: "bash", resultText: "…\nProcess exited with code 2" }))).toBe(true);
  });
  it("does not flag a clean result, an exit code 0, or an explicit error (already handled)", () => {
    expect(resultSuggestsFailure(tool({ name: "bash", resultText: "654 passed" }))).toBe(false);
    expect(resultSuggestsFailure(tool({ name: "bash", resultText: "exited with code 0" }))).toBe(false);
    expect(resultSuggestsFailure(tool({ name: "bash", isError: true, resultText: "ENOENT" }))).toBe(false);
  });
  it("only reads the tail — an early mention scrolled far above the end does not flag", () => {
    const result = `note: 'ENOENT' can appear in logs\n${"ok line\n".repeat(200)}done`;
    expect(resultSuggestsFailure(tool({ name: "bash", resultText: result }))).toBe(false);
  });
  it("surfaces as looksFailed on the presentation only for the command family", () => {
    const bash = presentTool(tool({ name: "bash", args: { command: "tscc" }, resultText: "command not found" }));
    expect(bash.looksFailed).toBe(true);
    const read = presentTool(tool({ name: "read", args: { path: "a.md" }, resultText: "command not found" }));
    expect(read.looksFailed).toBeUndefined();
  });
});

describe("resultSuggestsFailure — reviewer false-positive regressions (grok/codex r3 gauntlet)", () => {
  it("a passing test that asserts on 'command not found' text stays clean", () => {
    const resultText =
      "✓ handles missing binary\n  expect(msg).toMatch(/command not found/)\n\n Test Files  1 passed (1)\n";
    expect(resultSuggestsFailure(tool({ name: "bash", resultText }))).toBe(false);
  });
  it("grep/rg output that merely contains ENOENT stays clean", () => {
    expect(
      resultSuggestsFailure(tool({ name: "bash", resultText: "src/errors.ts:12: throw new Error('ENOENT')" })),
    ).toBe(false);
  });
  it("a printf of the phrase mid-output with clean lines after stays clean", () => {
    expect(
      resultSuggestsFailure(
        tool({ name: "bash", resultText: "command not found\nrecovered\nall good" }),
      ),
    ).toBe(false);
  });
  it("real shell diagnostics on the last lines still flag", () => {
    expect(
      resultSuggestsFailure(tool({ name: "bash", resultText: "sh: tscc: command not found" })),
    ).toBe(true);
    expect(
      resultSuggestsFailure(tool({ name: "bash", resultText: "cat: missing.txt: No such file or directory" })),
    ).toBe(true);
    expect(resultSuggestsFailure(tool({ name: "bash", resultText: "spawn tsc ENOENT" }))).toBe(true);
  });
  it("streaming partials never flag (no settled result yet)", () => {
    expect(
      resultSuggestsFailure(tool({ name: "bash", partialText: "sh: x: command not found" })),
    ).toBe(false);
  });
});
