import type { UIMessage } from "@ai-sdk/react";
import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "@/modules/fleet/lib/fleetTranscript";
import {
  finalizeStream,
  initStreamState,
  latestUserText,
  stepStream,
} from "./daemonTranscriptStream";

function userMsg(text: string): UIMessage {
  return { id: "u1", role: "user", parts: [{ type: "text", text }] } as UIMessage;
}

describe("latestUserText", () => {
  it("returns the last user message's text", () => {
    const msgs = [
      userMsg("first"),
      { id: "a", role: "assistant", parts: [{ type: "text", text: "hi" }] },
      userMsg("  second  "),
    ] as UIMessage[];
    expect(latestUserText(msgs)).toBe("second");
  });
  it("is empty when there is no user message", () => {
    expect(latestUserText([])).toBe("");
  });
});

describe("stepStream — delta diffing", () => {
  it("emits text-start then only the appended suffix as deltas", () => {
    let st = initStreamState();
    const r1 = stepStream(st, [
      { kind: "assistant", text: "Hel", ts: 0, seq: 5 },
    ]);
    st = r1.state;
    expect(r1.chunks).toEqual([
      { type: "text-start", id: "s5" },
      { type: "text-delta", id: "s5", delta: "Hel" },
    ]);

    // the SAME entry grows — only the new suffix is emitted
    const r2 = stepStream(st, [
      { kind: "assistant", text: "Hello there", ts: 0, seq: 5 },
    ]);
    st = r2.state;
    expect(r2.chunks).toEqual([
      { type: "text-delta", id: "s5", delta: "lo there" },
    ]);

    // no growth → no chunks
    const r3 = stepStream(st, [
      { kind: "assistant", text: "Hello there", ts: 0, seq: 5 },
    ]);
    expect(r3.chunks).toEqual([]);
  });

  it("maps thinking → reasoning and assistant → text as separate blocks", () => {
    let st = initStreamState();
    const r1 = stepStream(st, [{ kind: "thinking", text: "hmm", ts: 0, seq: 1 }]);
    st = r1.state;
    const r2 = stepStream(st, [{ kind: "assistant", text: "ok", ts: 0, seq: 2 }]);
    expect(r1.chunks[0]).toEqual({ type: "reasoning-start", id: "s1" });
    expect(r1.chunks[1]).toEqual({ type: "reasoning-delta", id: "s1", delta: "hmm" });
    expect(r2.chunks[0]).toEqual({ type: "text-start", id: "s2" });
  });

  it("skips user echoes, tool steps and system entries (not streamed to the bubble)", () => {
    const st = initStreamState();
    const r = stepStream(st, [
      { kind: "user", text: "my prompt", ts: 0, seq: 3 },
      { kind: "tool", text: "ran grep", ts: 0, seq: 4 },
      { kind: "system", text: "note", ts: 0, seq: 5 },
    ] as TranscriptEntry[]);
    expect(r.chunks).toEqual([]);
  });

  it("skips entries with no stable key (no seq, no id)", () => {
    const st = initStreamState();
    const r = stepStream(st, [{ kind: "assistant", text: "x", ts: 0 }]);
    expect(r.chunks).toEqual([]);
  });
});

describe("finalizeStream", () => {
  it("closes every open block in first-seen order", () => {
    let st = initStreamState();
    st = stepStream(st, [{ kind: "thinking", text: "t", ts: 0, seq: 1 }]).state;
    st = stepStream(st, [{ kind: "assistant", text: "a", ts: 0, seq: 2 }]).state;
    expect(finalizeStream(st)).toEqual([
      { type: "reasoning-end", id: "s1" },
      { type: "text-end", id: "s2" },
    ]);
  });
  it("returns nothing when no blocks were opened", () => {
    expect(finalizeStream(initStreamState())).toEqual([]);
  });
});
