import { describe, expect, it } from "vitest";
import {
  ANCHOR_OFFSET_PX,
  isNearEnd,
  resolveAnchorScrollTop,
  resolveAnchorSpacerPx,
  resolveModeOnUserScroll,
} from "./scrollAnchoring";

describe("isNearEnd", () => {
  it("true at the exact bottom and within the threshold", () => {
    expect(isNearEnd(1000, 1600, 600)).toBe(true);
    expect(isNearEnd(970, 1600, 600)).toBe(true); // 30px short of bottom
  });
  it("false once scrolled further up than the threshold", () => {
    expect(isNearEnd(900, 1600, 600)).toBe(false); // 100px short
  });
  it("true for content shorter than the viewport (nothing to scroll)", () => {
    expect(isNearEnd(0, 400, 600)).toBe(true);
  });
});

describe("resolveAnchorSpacerPx — reserved space below the just-sent message", () => {
  it("reserves the full usable viewport when the anchor is the last content", () => {
    // anchor row at the very end: contentEnd - anchorTop = row height 24px
    expect(
      resolveAnchorSpacerPx({ containerHeight: 616, anchorTop: 1000, contentEnd: 1024 }),
    ).toBe(616 - ANCHOR_OFFSET_PX - 24);
  });
  it("shrinks as the reply streams into the reserved space", () => {
    const spacer = resolveAnchorSpacerPx({
      containerHeight: 616,
      anchorTop: 1000,
      contentEnd: 1400,
    });
    expect(spacer).toBe(616 - ANCHOR_OFFSET_PX - 400);
  });
  it("clamps to 0 once content below the anchor fills the viewport", () => {
    expect(
      resolveAnchorSpacerPx({ containerHeight: 616, anchorTop: 1000, contentEnd: 1700 }),
    ).toBe(0);
  });
  it("never exceeds the usable viewport even for a degenerate zero-height anchor tail", () => {
    expect(
      resolveAnchorSpacerPx({ containerHeight: 616, anchorTop: 1000, contentEnd: 1000 }),
    ).toBe(616 - ANCHOR_OFFSET_PX);
  });
});

describe("resolveAnchorScrollTop", () => {
  it("pins the anchor ANCHOR_OFFSET_PX below the viewport top", () => {
    expect(resolveAnchorScrollTop(1000)).toBe(1000 - ANCHOR_OFFSET_PX);
  });
  it("clamps at 0 for a message near the very top", () => {
    expect(resolveAnchorScrollTop(4)).toBe(0);
  });
});

describe("resolveModeOnUserScroll", () => {
  it("near the end resumes following; anywhere else is free-scrolling", () => {
    expect(resolveModeOnUserScroll(true)).toBe("following-end");
    expect(resolveModeOnUserScroll(false)).toBe("free-scrolling");
  });
});
