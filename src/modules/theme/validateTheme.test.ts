import { describe, expect, it } from "vitest";
import { validateTheme } from "./validateTheme";

describe("validateTheme", () => {
  it("accepts a minimal theme with only a dark variant", () => {
    const result = validateTheme({
      id: "my-theme",
      name: "My Theme",
      variants: { dark: { colors: { background: "#000000" } } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a theme carrying an unrecognized color key", () => {
    const result = validateTheme({
      id: "my-theme",
      name: "My Theme",
      variants: { dark: { colors: { notARealKey: "#000000" } } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not a recognized color key");
    }
  });

  it("accepts a theme that carries the t3face status token family", () => {
    const result = validateTheme({
      id: "my-theme",
      name: "My Theme",
      variants: {
        dark: {
          colors: {
            warning: "#f59e0b",
            warningForeground: "#78350f",
            info: "#3b82f6",
            infoForeground: "#1e3a8a",
            success: "#22c55e",
            successForeground: "#14532d",
            pending: "#8b5cf6",
            pendingForeground: "#4c1d95",
          },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.variants.dark?.colors?.warning).toBe("#f59e0b");
      expect(result.theme.variants.dark?.colors?.pendingForeground).toBe("#4c1d95");
    }
  });

  it("a bogus key alongside valid status keys still rejects the whole theme", () => {
    const result = validateTheme({
      id: "my-theme",
      name: "My Theme",
      variants: {
        dark: {
          colors: {
            warning: "#f59e0b",
            totallyBogus: "#000000",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("a theme carrying only a partial status subset still validates (fallthrough is per-key)", () => {
    const result = validateTheme({
      id: "my-theme",
      name: "My Theme",
      variants: { dark: { colors: { warning: "#f59e0b" } } },
    });
    expect(result.ok).toBe(true);
  });
});
