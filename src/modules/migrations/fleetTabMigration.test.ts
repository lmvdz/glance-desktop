import { describe, expect, it } from "vitest";
import type { SerializedTab } from "@/modules/spaces/lib/serialize";
import { dropFleetTabs } from "./fleetTabMigration";

describe("dropFleetTabs", () => {
  it("removes legacy fleet tabs while keeping order of the rest", () => {
    const tabs: SerializedTab[] = [
      { kind: "editor", path: "/a.ts" },
      { kind: "fleet" },
      { kind: "terminal", tree: { kind: "leaf", active: true } },
      { kind: "fleet" },
      { kind: "preview", url: "https://example.com" },
    ];
    expect(dropFleetTabs(tabs)).toEqual([
      { kind: "editor", path: "/a.ts" },
      { kind: "terminal", tree: { kind: "leaf", active: true } },
      { kind: "preview", url: "https://example.com" },
    ]);
  });

  it("leaves a fleet-free list untouched", () => {
    const tabs: SerializedTab[] = [
      { kind: "editor", path: "/a.ts" },
      { kind: "markdown", path: "/readme.md" },
    ];
    expect(dropFleetTabs(tabs)).toEqual(tabs);
  });

  it("returns [] for a space that held only fleet tabs", () => {
    expect(dropFleetTabs([{ kind: "fleet" }, { kind: "fleet" }])).toEqual([]);
  });

  it("tolerates a non-array (corrupt state)", () => {
    expect(dropFleetTabs(undefined as unknown as SerializedTab[])).toEqual([]);
  });
});
