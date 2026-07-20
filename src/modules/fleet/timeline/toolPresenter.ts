// Turns a raw `TranscriptTool` into a calm, human-readable line — the fix for the
// `bash {"command":"tsc …"}` JSON wall (hub-shell H2). Pure and dependency-free so the whole
// vocabulary is unit-testable without a DOM: `ToolLine` renders `verb` + `subject` (+ optional
// `detail`) in the existing dot/icon grammar, and only reveals the raw args/result JSON one fold
// deeper on demand — never by default.
//
// The tool vocabulary is grounded in REAL captured transcripts (~/.glance receipts + org
// transcripts): the live harnesses emit lowercase names (`bash`, `read`, `edit`, `grep`, `glob`,
// `todo`, `search`, `search_tool_bm25`, `stage`, `mcp__*`) with structured `args`
// (`bash`→`{command,cwd,timeout}`, `read`/`glob`→`{path}`, `grep`→`{pattern,path}`,
// `search_tool_bm25`→`{query}`). To stay robust across harness families we also accept the
// capitalized Claude-Code vocabulary (`Read`/`Write`/`Edit`/`Bash`/`Grep`/`Glob` with `file_path`)
// and the ACP `kind` vocabulary (`read`/`edit`/`execute`/`search`/`fetch`), where `args` may be
// absent and the subject is left empty for the caller to backfill from the entry's intent text.

import type { TranscriptTool } from "../lib/fleetTranscript";

export interface ToolPresentation {
  /** Human verb — "Ran", "Read", "Wrote", "Edited", "Searched", or a humanized tool name. */
  verb: string;
  /** The thing the verb acts on — a command, a repo-relative path, a pattern. May be "" when the
   *  harness gave us no structured args (ACP kinds); the caller backfills from the intent text. */
  subject: string;
  /** An optional calm qualifier ("in packages/dagon", "5 results") — never the raw args JSON. */
  detail?: string;
  /** True when a command tool reported ok but its output tail reads like a failure (nonzero exit,
   *  command not found, ENOENT) — t3's `toolDetailTextLooksLikeFailure` heuristic, scoped to the
   *  command family only so file contents echoed by read tools can never false-positive. */
  looksFailed?: boolean;
}

const SUBJECT_MAX = 140;

/** Collapse internal whitespace/newlines to a single line and trim — a multi-line command becomes
 *  one readable summary; the full text still lives in the expand fold. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = SUBJECT_MAX): string {
  const s = oneLine(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function asArgs(tool: TranscriptTool): Record<string, unknown> | undefined {
  if (tool.args && typeof tool.args === "object" && !Array.isArray(tool.args)) {
    return tool.args as Record<string, unknown>;
  }
  // Some entries carry only the serialized `argsText`; parse it best-effort.
  if (typeof tool.argsText === "string" && tool.argsText.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(tool.argsText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through — not valid JSON, treat as no structured args
    }
  }
  return undefined;
}

/** First present string-ish value among candidate keys. Arrays (an argv-style command) join with a
 *  space; numbers/booleans stringify; everything else is skipped. */
function pick(
  args: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!args) return undefined;
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v;
    if (Array.isArray(v) && v.length > 0) {
      return v.map((x) => (typeof x === "string" ? x : String(x))).join(" ");
    }
    if (typeof v === "number" || typeof v === "boolean") return String(v);
  }
  return undefined;
}

/** "search_tool_bm25" → "Search tool bm25"; "read_file" → "Read file". */
function humanize(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.length === 0 ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

/** A short, calm preview of args for an unknown tool — the most meaningful string value, else the
 *  serialized args truncated. Never the caller's job to JSON.stringify. */
function argPreview(tool: TranscriptTool): string {
  const args = asArgs(tool);
  const primary = pick(args, [
    "command",
    "path",
    "file_path",
    "pattern",
    "query",
    "url",
    "name",
    "input",
    "prompt",
  ]);
  if (primary) return truncate(primary);
  if (args) {
    const firstString = Object.values(args).find(
      (v) => typeof v === "string" && v.trim(),
    );
    if (typeof firstString === "string") return truncate(firstString);
  }
  return "";
}

const PATH_KEYS = ["path", "file_path", "filename", "filePath", "target_file", "file"];
const PATTERN_KEYS = ["pattern", "query", "regex", "q", "search"];
const COMMAND_KEYS = ["command", "cmd", "script", "run"];

/** Strip one layer of matching quotes off a shell-wrapped inner command. */
function stripMatchingQuotes(value: string): string {
  const s = value.trim();
  if (s.length >= 2) {
    const first = s[0];
    if ((first === '"' || first === "'") && s[s.length - 1] === first) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// Shell wrappers, in match order. POSIX shells only unwrap when the flag cluster carries `c`
// (bash -lc/-c/-l -c…); `pwsh -Command`/`cmd /c` are explicit. Ported shape from t3code's
// `unwrapKnownShellCommandWrapper` (session-logic.ts, © 2026 T3 Tools Inc., MIT License).
const POSIX_WRAPPER_RE = /^\s*(?:bash|sh|zsh|dash)((?:\s+-[a-zA-Z]+)+)\s+([\s\S]+)$/;
const PWSH_WRAPPER_RE =
  /^\s*(?:pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*-c(?:ommand)?\s+([\s\S]+)$/i;
const CMD_WRAPPER_RE = /^\s*cmd(?:\.exe)?\s+\/[cC]\s+([\s\S]+)$/;

/**
 * Unwrap known shell-wrapper invocations so the row reads the INNER command — glance transcripts
 * are full of `bash -lc "tsc --noEmit"` rows that should present as `tsc --noEmit`. The full
 * wrapped text still lives in the expand fold. Unwraps repeatedly (capped) for nested wrappers.
 */
export function unwrapShellCommand(command: string): string {
  let current = command.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const posix = POSIX_WRAPPER_RE.exec(current);
    if (posix?.[1].replace(/[\s-]/g, "").includes("c")) {
      current = stripMatchingQuotes(posix[2]);
      continue;
    }
    const pwsh = PWSH_WRAPPER_RE.exec(current);
    if (pwsh) {
      current = stripMatchingQuotes(pwsh[1]);
      continue;
    }
    const cmd = CMD_WRAPPER_RE.exec(current);
    if (cmd) {
      current = stripMatchingQuotes(cmd[1]);
      continue;
    }
    break;
  }
  return current;
}

/** How much of the result TAIL the failure heuristic reads — failures announce themselves at the
 *  end of output; scanning the whole result would false-positive on e.g. a test log quoted early. */
const FAILURE_SCAN_TAIL_CHARS = 240;

const FAILURE_TAIL_PATTERNS: RegExp[] = [
  /command not found/i,
  /no such file or directory/i,
  /\bENOENT\b/,
  /is not recognized as (?:an internal or external command|the name of a cmdlet)/i,
  /exit(?:ed)?(?: with)? (?:status|code):? [1-9]\d*/i,
  /non-zero exit/i,
];

/**
 * True when a command tool's output tail reads like a failure even though the harness reported
 * ok — harnesses routinely mark a ran-but-failed command as a successful tool call (the tool DID
 * run). Only ever consulted for the command family, and never overrides an explicit error status.
 */
export function resultSuggestsFailure(tool: TranscriptTool): boolean {
  if (tool.isError) return false; // already an explicit failure — nothing to suggest
  const result = tool.resultText ?? tool.partialText;
  if (!result) return false;
  const tail = result.slice(-FAILURE_SCAN_TAIL_CHARS);
  return FAILURE_TAIL_PATTERNS.some((re) => re.test(tail));
}

/** Map an MCP tool id ("mcp__plane_list_work_items") to a calm "Plane · list work items". */
function presentMcp(name: string, tool: TranscriptTool): ToolPresentation {
  const rest = name.slice("mcp__".length);
  const underscore = rest.indexOf("_");
  const server = underscore > 0 ? rest.slice(0, underscore) : rest;
  const action = underscore > 0 ? rest.slice(underscore + 1) : "";
  const verb = server.charAt(0).toUpperCase() + server.slice(1);
  const subject = action ? action.replace(/_+/g, " ") : argPreview(tool);
  return { verb, subject };
}

/**
 * Present a tool call as verb + subject (+ optional detail). Pure: no DOM, no side effects, total
 * over any `TranscriptTool`. A missing/odd-shaped `args` degrades to an empty subject rather than
 * throwing — the renderer backfills from the entry's intent text in that case.
 */
export function presentTool(tool: TranscriptTool): ToolPresentation {
  const name = (tool.name ?? "tool").trim();
  const key = name.toLowerCase();
  const args = asArgs(tool);

  if (key.startsWith("mcp__")) return presentMcp(name, tool);

  switch (key) {
    case "bash":
    case "shell":
    case "sh":
    case "execute":
    case "run":
    case "run_command":
    case "run_terminal_cmd":
    case "terminal": {
      const command = pick(args, COMMAND_KEYS) ?? "";
      const cwd = pick(args, ["cwd", "workdir", "directory"]);
      const detail = cwd && cwd !== "." && cwd !== "./" ? `in ${cwd}` : undefined;
      const looksFailed = resultSuggestsFailure(tool) || undefined;
      return { verb: "Ran", subject: truncate(unwrapShellCommand(command)), detail, looksFailed };
    }
    case "read":
    case "read_file":
    case "cat":
    case "view":
    case "view_file":
    case "open":
      return { verb: "Read", subject: truncate(pick(args, PATH_KEYS) ?? "") };
    case "write":
    case "write_file":
    case "create":
    case "create_file":
    case "new_file":
      return { verb: "Wrote", subject: truncate(pick(args, PATH_KEYS) ?? "") };
    case "edit":
    case "ast_edit":
    case "multiedit":
    case "str_replace":
    case "str_replace_editor":
    case "apply_patch":
    case "update":
    case "patch":
      return { verb: "Edited", subject: truncate(pick(args, PATH_KEYS) ?? "") };
    case "grep":
    case "search":
    case "ripgrep":
    case "search_tool_bm25":
    case "ast_grep":
    case "codebase_search":
    case "code_search": {
      const subject = pick(args, PATTERN_KEYS) ?? pick(args, PATH_KEYS) ?? "";
      return { verb: "Searched", subject: truncate(subject) };
    }
    case "glob":
    case "find":
    case "list":
    case "ls":
    case "list_dir":
    case "list_directory": {
      const subject = pick(args, PATTERN_KEYS) ?? pick(args, PATH_KEYS) ?? "";
      return { verb: "Searched", subject: truncate(subject) };
    }
    case "web_search":
    case "websearch":
      return { verb: "Searched the web", subject: truncate(pick(args, ["query", "q", "search"]) ?? "") };
    case "fetch":
    case "web_fetch":
    case "webfetch":
      return { verb: "Fetched", subject: truncate(pick(args, ["url", "uri", "href"]) ?? "") };
    case "todo":
    case "todowrite":
    case "update_plan":
    case "plan":
      return { verb: "Updated the plan", subject: "" };
    case "stage":
      // Workflow stage marker — its label lives in the entry's intent text, not in args. Leave the
      // subject empty for the renderer to backfill.
      return { verb: "Stage", subject: "" };
    case "task":
    case "job":
    case "agent":
      return { verb: "Delegated", subject: truncate(pick(args, ["description", "prompt", "name"]) ?? "") };
    default:
      return { verb: humanize(name), subject: argPreview(tool) };
  }
}
