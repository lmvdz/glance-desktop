import { describe, expect, it } from "vitest";
import {
  canOpenUnitWorktree,
  isLoopbackDaemon,
  resolveOpenAction,
} from "./worktreeOpener";

describe("resolveOpenAction — create-or-focus (no duplicate Spaces)", () => {
  const spaces = [
    { id: "s1", root: "/home/u/wt/web-ui" },
    { id: "s2", root: null },
    { id: "s3", root: "/home/u/wt/api" },
  ];

  it("focuses the existing Space when one is already rooted at the worktree", () => {
    expect(resolveOpenAction(spaces, "/home/u/wt/api")).toEqual({
      kind: "focus",
      id: "s3",
    });
  });

  it("creates a new Space when no Space is rooted there", () => {
    expect(resolveOpenAction(spaces, "/home/u/wt/new")).toEqual({
      kind: "create",
    });
  });

  it("a null-root Space never matches a worktree path", () => {
    expect(resolveOpenAction(spaces, "/home/u/wt/api").kind).toBe("focus");
    expect(resolveOpenAction([{ id: "s2", root: null }], "/anything")).toEqual({
      kind: "create",
    });
  });
});

describe("isLoopbackDaemon — worktree openable only for a local daemon", () => {
  it("is true for loopback hosts", () => {
    expect(isLoopbackDaemon("http://127.0.0.1:7878")).toBe(true);
    expect(isLoopbackDaemon("http://localhost:7878")).toBe(true);
    expect(isLoopbackDaemon("http://[::1]:7878")).toBe(true);
  });

  it("is false for a remote daemon (worktree lives on another host)", () => {
    expect(isLoopbackDaemon("https://fleet.example.com")).toBe(false);
    expect(isLoopbackDaemon("http://10.0.0.5:7878")).toBe(false);
    expect(isLoopbackDaemon("http://192.168.1.20:7878")).toBe(false);
  });

  it("is false for an unparseable URL", () => {
    expect(isLoopbackDaemon("")).toBe(false);
    expect(isLoopbackDaemon("not a url")).toBe(false);
  });
});

describe("canOpenUnitWorktree — gated by the UNIT's own daemon, not the active one (M02)", () => {
  const connections = [
    { id: "laptop", baseUrl: "http://127.0.0.1:7878" },
    { id: "workstation", baseUrl: "https://fleet.example.com" },
  ];

  it("is true when the unit's daemon is loopback", () => {
    expect(canOpenUnitWorktree(connections, "laptop")).toBe(true);
  });

  it("is false when the unit's daemon is remote, even if another daemon is loopback", () => {
    expect(canOpenUnitWorktree(connections, "workstation")).toBe(false);
  });

  it("fails closed for an unknown/removed daemon id", () => {
    expect(canOpenUnitWorktree(connections, "gone")).toBe(false);
  });
});
