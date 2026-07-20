import { describe, expect, it, vi } from "vitest";
import type { FleetClient } from "./fleetClient";
import { startConsoleThread } from "./startThread";

// The recovery paths here were the top findings of the r3 cross-lineage review (grok + codex):
// a created-but-unsent thread must never be silently orphaned, never double-created, and never
// selected before the caller can re-home the typed message.

function fakeClient(over: Partial<Record<"createConsole" | "steer", unknown>>) {
  return {
    createConsole: vi.fn(async () => "u1"),
    steer: vi.fn(async () => ({ ok: true })),
    ...over,
  } as unknown as FleetClient;
}

function deps(client: FleetClient, over: Partial<Parameters<typeof startConsoleThread>[0]> = {}) {
  return {
    client: async () => client,
    activeId: "d1",
    refresh: vi.fn(async () => {}),
    select: vi.fn(),
    hasUnit: () => true,
    ...over,
  };
}

describe("startConsoleThread", () => {
  it("success: creates, steers the first message, refreshes, then selects", async () => {
    const c = fakeClient({});
    const d = deps(c, { firstMessage: "hello" });
    const res = await startConsoleThread(d);
    expect(res).toEqual({ ok: true, unitId: "u1" });
    expect(d.select).toHaveBeenCalledWith("d1:u1");
    expect(d.refresh).toHaveBeenCalled();
  });

  it("failed first steer returns the created unitId and does NOT select", async () => {
    const c = fakeClient({ steer: vi.fn(async () => ({ ok: false, detail: "409" })) });
    const d = deps(c, { firstMessage: "hello" });
    const res = await startConsoleThread(d);
    expect(res).toEqual({ ok: false, unitId: "u1", reason: "409" });
    expect(d.select).not.toHaveBeenCalled();
  });

  it("a throw AFTER creation still reports the created unitId (retry must not re-create)", async () => {
    const c = fakeClient({
      steer: vi.fn(async () => {
        throw new Error("network died");
      }),
    });
    const d = deps(c, { firstMessage: "hello" });
    const res = await startConsoleThread(d);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.unitId).toBe("u1");
      expect(res.reason).toBe("network died");
    }
  });

  it("create returning null fails without a unitId", async () => {
    const c = fakeClient({ createConsole: vi.fn(async () => null) });
    const res = await startConsoleThread(deps(c));
    expect(res).toEqual({ ok: false, reason: "Couldn't start a new thread on this daemon." });
  });

  it("concurrent starts on the same daemon: exactly one createConsole (shared in-flight lock)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const c = fakeClient({
      createConsole: vi.fn(async () => {
        await gate;
        return "u1";
      }),
    });
    const d = deps(c);
    const first = startConsoleThread(d);
    const second = await startConsoleThread(deps(c)); // while the first is parked on the gate
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/already being created/);
    release();
    const firstRes = await first;
    expect(firstRes.ok).toBe(true);
    expect(
      (c as unknown as { createConsole: ReturnType<typeof vi.fn> }).createConsole,
    ).toHaveBeenCalledTimes(1);
  });
});
