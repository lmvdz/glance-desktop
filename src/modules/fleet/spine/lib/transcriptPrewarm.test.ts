import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetClient } from "../../lib/fleetClient";
import type { FleetStatus, FleetUnit } from "../../lib/fleetRoster";
import { unitKey } from "../../lib/fleetRoster";
import {
  __resetPrewarmCacheForTests,
  getPrewarmedTranscript,
  prewarmTopUnits,
} from "./transcriptPrewarm";

function unit(
  over: Partial<FleetUnit> & { id: string; name: string; status: FleetStatus },
): FleetUnit {
  return { repo: "/r", daemonId: "d1", ...over };
}

/** A fake client factory whose `.transcript()` returns a fixed payload (or throws), recording
 *  every call so tests can assert fetch counts without a real FleetClient/fetch. */
function fakeClientFactory(
  behavior: (unitId: string) => unknown,
): { calls: string[]; client: (daemonId: string) => Promise<FleetClient> } {
  const calls: string[] = [];
  const client = async (_daemonId: string) =>
    ({
      transcript: async (id: string) => {
        calls.push(id);
        const result = behavior(id);
        if (result instanceof Error) throw result;
        return result;
      },
    }) as unknown as FleetClient;
  return { calls, client };
}

describe("prewarmTopUnits / getPrewarmedTranscript", () => {
  afterEach(() => __resetPrewarmCacheForTests());

  it("fetches and caches the transcript for a target unit", async () => {
    const { client } = fakeClientFactory(() => [
      { kind: "user", text: "hi", ts: 1 },
    ]);
    const u = unit({ id: "1", name: "a", status: "input" });
    await prewarmTopUnits([u], { client });
    expect(getPrewarmedTranscript(unitKey(u))).toEqual([
      { kind: "user", text: "hi", ts: 1 },
    ]);
  });

  it("only warms the top N units by roster order", async () => {
    const { calls, client } = fakeClientFactory(() => []);
    const units = Array.from({ length: 15 }, (_, i) =>
      unit({ id: `${i}`, name: `u${i}`, status: "idle" }),
    );
    await prewarmTopUnits(units, { limit: 10, client });
    expect(calls).toHaveLength(10);
  });

  it("skips the currently-selected unit (its own live poll already keeps it warm)", async () => {
    const { calls, client } = fakeClientFactory(() => []);
    const u1 = unit({ id: "1", name: "a", status: "idle" });
    const u2 = unit({ id: "2", name: "b", status: "idle" });
    await prewarmTopUnits([u1, u2], { skipKey: unitKey(u1), client });
    expect(calls).toEqual(["2"]);
  });

  it("does not re-fetch a unit whose cache entry is still fresh", async () => {
    const { calls, client } = fakeClientFactory(() => []);
    const u = unit({ id: "1", name: "a", status: "idle" });
    await prewarmTopUnits([u], { client });
    await prewarmTopUnits([u], { client });
    expect(calls).toEqual(["1"]); // second call was a no-op — still within MIN_REFETCH_MS
  });

  it("swallows a per-unit fetch failure without throwing and without wiping a prior cache entry", async () => {
    let fail = false;
    const { client } = fakeClientFactory((id) => {
      if (fail) return new Error("network blip");
      return [{ kind: "user", text: `warm-${id}`, ts: 1 }];
    });
    const u = unit({ id: "1", name: "a", status: "idle" });
    await prewarmTopUnits([u], { client });
    expect(getPrewarmedTranscript(unitKey(u))).toEqual([
      { kind: "user", text: "warm-1", ts: 1 },
    ]);

    fail = true;
    const realNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(realNow + 10_000); // clear the refetch throttle
    await prewarmTopUnits([u], { client });
    vi.useRealTimers();

    // Cache still holds the last GOOD snapshot — a transient failure doesn't blank the pane.
    expect(getPrewarmedTranscript(unitKey(u))).toEqual([
      { kind: "user", text: "warm-1", ts: 1 },
    ]);
  });

  it("returns undefined for a unit that was never prewarmed", () => {
    expect(getPrewarmedTranscript("d1:never-warmed")).toBeUndefined();
  });
});
