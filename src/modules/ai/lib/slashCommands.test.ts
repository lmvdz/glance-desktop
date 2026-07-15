import { describe, expect, it } from "vitest";
import { COMMAND_MARKER_RE, wrapWithCommandMarker } from "./slashCommands";

describe("COMMAND_MARKER_RE", () => {
  it("matches the current glance-command marker", () => {
    const text = wrapWithCommandMarker("do the thing", "init");
    const m = text.match(COMMAND_MARKER_RE);
    expect(m?.[1]).toBe("init");
  });

  it("still matches a pre-rename terax-command marker (sessions saved before the rename)", () => {
    const legacy = '<terax-command name="init" />\n\ndo the thing';
    const m = legacy.match(COMMAND_MARKER_RE);
    expect(m?.[1]).toBe("init");
  });

  it("captures the optional state attribute on both marker forms", () => {
    const glance = '<glance-command name="plan" state="done" />\n\nhi';
    const terax = '<terax-command name="plan" state="done" />\n\nhi';
    expect(glance.match(COMMAND_MARKER_RE)?.[2]).toBe("done");
    expect(terax.match(COMMAND_MARKER_RE)?.[2]).toBe("done");
  });

  it("wrapWithCommandMarker always writes the new marker form", () => {
    expect(wrapWithCommandMarker("hi", "init")).toBe(
      '<glance-command name="init" />\n\nhi',
    );
  });
});
