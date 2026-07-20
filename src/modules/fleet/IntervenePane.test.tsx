// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntervenePane } from "./IntervenePane";
import type { FleetUnit } from "./lib/fleetRoster";
import { useSteerDraftStore } from "./store/fleetSteerDraftStore";

// IntervenePane pulls in a live ACP transcript poll, a diff fetch, and a workspace-lease overlay
// — none of which this test cares about (it's about the STEER COMPOSER surviving unmount). Mock
// the stores/components it reads so mounting it never does real network I/O.
const steerMock = vi.fn(async () => ({ ok: true }) as { ok: boolean; detail?: string });
const interruptMock = vi.fn(async () => undefined);
const diffMock = vi.fn(async () => [] as unknown[]);
const clientMock = vi.fn(async () => ({
  diff: diffMock,
  steer: steerMock,
  interrupt: interruptMock,
}));

vi.mock("./store/fleetConnectionStore", () => ({
  useFleetConnection: (selector: (s: { client: typeof clientMock }) => unknown) =>
    selector({ client: clientMock }),
}));

vi.mock("./store/fleetTranscriptStore", () => ({
  useFleetTranscript: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      entries: [],
      start: vi.fn(),
      stop: vi.fn(),
      addOptimistic: vi.fn(),
    }),
}));

vi.mock("./ConversationView", () => ({
  ConversationView: () => null,
}));

vi.mock("./WorkspaceOverlay", () => ({
  WorkspaceOverlay: () => null,
}));

function testUnit(overrides: Partial<FleetUnit> = {}): FleetUnit {
  return {
    id: "u1",
    name: "unit-1",
    status: "idle",
    repo: "/repo",
    daemonId: "d1",
    ...overrides,
  };
}

function getSteerTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(
    /message this unit/i,
  ) as HTMLTextAreaElement;
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        get length() {
          return map.size;
        },
      } satisfies Storage;
    })(),
    configurable: true,
  });
  useSteerDraftStore.setState({ drafts: {} });
  steerMock.mockClear();
  interruptMock.mockClear();
  diffMock.mockClear();
  clientMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("IntervenePane steer composer — draft survives unmount (law-5 fix)", () => {
  it("restores in-progress text after the pane unmounts and remounts for the same unit", () => {
    const u = testUnit();

    const first = render(
      <IntervenePane unit={u} canOpen={false} onBack={() => {}} />,
    );
    fireEvent.change(getSteerTextarea(), {
      target: { value: "half-typed instruction" },
    });
    expect(getSteerTextarea().value).toBe("half-typed instruction");

    // This is exactly what RosterView does when the roster poll shows the selected unit has
    // vanished (landed / removed): its own effect calls `select(null)`, which swaps
    // <IntervenePane> out of the tree entirely.
    first.unmount();

    // ...and this is what happens on reselect: RosterView renders a brand-new
    // <IntervenePane unit={selected} .../> for the same unit — a fresh component instance,
    // not the same one resuming.
    render(<IntervenePane unit={u} canOpen={false} onBack={() => {}} />);
    expect(getSteerTextarea().value).toBe("half-typed instruction");
  });

  it("keys drafts per unit (daemonId:id) so two different units never share a draft", () => {
    const a = testUnit({ id: "a", daemonId: "d1" });
    const b = testUnit({ id: "b", daemonId: "d1" });

    const paneA = render(
      <IntervenePane unit={a} canOpen={false} onBack={() => {}} />,
    );
    fireEvent.change(getSteerTextarea(), { target: { value: "for unit a" } });
    paneA.unmount();

    const paneB = render(
      <IntervenePane unit={b} canOpen={false} onBack={() => {}} />,
    );
    expect(getSteerTextarea().value).toBe(""); // unit b never had a draft
    fireEvent.change(getSteerTextarea(), { target: { value: "for unit b" } });
    paneB.unmount();

    render(<IntervenePane unit={a} canOpen={false} onBack={() => {}} />);
    expect(getSteerTextarea().value).toBe("for unit a");
  });

  it("clears the draft once the message is actually sent", async () => {
    const u = testUnit();
    render(<IntervenePane unit={u} canOpen={false} onBack={() => {}} />);
    fireEvent.change(getSteerTextarea(), { target: { value: "ship it" } });
    fireEvent.keyDown(getSteerTextarea(), {
      key: "Enter",
      ctrlKey: true,
    });
    // steer() clears the draft synchronously (before the network call resolves) — flush
    // microtasks so the store update from clearDraft has landed.
    await Promise.resolve();
    await Promise.resolve();
    expect(getSteerTextarea().value).toBe("");
    expect(steerMock).toHaveBeenCalledWith("u1", "ship it", expect.any(String));
  });
});

describe("regression proof — a plain useState composer DOES lose its text on unmount", () => {
  // This is the exact shape IntervenePane's steer composer had before this concern: the text
  // lived in `useState` local to the component. Reproducing that shape here (not by reverting
  // real code, but by writing the equivalent minimal component) demonstrates that THIS test
  // technique — type, unmount, remount, assert — actually catches the bug: run against the old
  // pattern, it fails to preserve text; run against the new store-backed IntervenePane above, it
  // preserves it. Same methodology, opposite outcomes, which is the point.
  function UseStateComposer() {
    const [text, setText] = useState("");
    return (
      <textarea
        placeholder="buggy steer composer"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    );
  }

  it("loses the draft the instant the component unmounts (the bug concern 08 fixes)", () => {
    const first = render(<UseStateComposer />);
    const ta = screen.getByPlaceholderText(
      "buggy steer composer",
    ) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "this used to vanish" } });
    expect(ta.value).toBe("this used to vanish");

    first.unmount();
    render(<UseStateComposer />);
    const restored = screen.getByPlaceholderText(
      "buggy steer composer",
    ) as HTMLTextAreaElement;
    expect(restored.value).toBe(""); // <- the law-5 data-loss bug, reproduced
  });
});
