// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  STEER_DRAFT_STORE_NAME,
  STEER_DRAFT_STORE_VERSION,
  getSteerDraft,
  useSteerDraftStore,
} from "./fleetSteerDraftStore";

beforeEach(() => {
  localStorage.clear();
  useSteerDraftStore.setState({ drafts: {} });
});

describe("useSteerDraftStore — setDraft/clearDraft", () => {
  it("stores a draft per unitKey and leaves other units untouched", () => {
    useSteerDraftStore.getState().setDraft("d1:a", "hello");
    useSteerDraftStore.getState().setDraft("d1:b", "world");
    expect(useSteerDraftStore.getState().drafts).toEqual({
      "d1:a": "hello",
      "d1:b": "world",
    });
  });

  it("scopes drafts by the full daemonId:id key, not the bare unit id (M02)", () => {
    useSteerDraftStore.getState().setDraft("d1:a", "from daemon 1");
    useSteerDraftStore.getState().setDraft("d2:a", "from daemon 2");
    expect(getSteerDraft("d1:a")).toBe("from daemon 1");
    expect(getSteerDraft("d2:a")).toBe("from daemon 2");
  });

  it('clearing an emptied draft removes the key instead of leaving a stale ""', () => {
    useSteerDraftStore.getState().setDraft("d1:a", "hi");
    useSteerDraftStore.getState().setDraft("d1:a", "");
    expect(useSteerDraftStore.getState().drafts).toEqual({});
  });

  it("clearDraft removes an explicit key (the post-send path)", () => {
    useSteerDraftStore.getState().setDraft("d1:a", "sent this");
    useSteerDraftStore.getState().clearDraft("d1:a");
    expect(getSteerDraft("d1:a")).toBe("");
  });

  it('getSteerDraft returns "" for a unit with no draft', () => {
    expect(getSteerDraft("nope")).toBe("");
  });
});

describe("useSteerDraftStore — localStorage persistence", () => {
  // The "migrate stub" describe block below is the app-restart simulation: it writes a raw
  // blob directly to localStorage (bypassing the live store) and rehydrates from it — exactly
  // what a fresh process does on boot, reading whatever the previous run left behind.
  it("persists drafts to localStorage under the versioned store name", async () => {
    useSteerDraftStore.getState().setDraft("d1:a", "persisted text");
    // zustand's persist middleware writes through a microtask; flush it before asserting
    // against the raw localStorage entry.
    await Promise.resolve();
    const raw = localStorage.getItem(STEER_DRAFT_STORE_NAME);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.drafts).toEqual({ "d1:a": "persisted text" });
    expect(parsed.version).toBe(STEER_DRAFT_STORE_VERSION);
  });
});

describe("useSteerDraftStore — migrate stub", () => {
  it("defaults to an empty drafts map for a payload with no drafts key (pre-v1 / corrupt)", async () => {
    localStorage.setItem(
      STEER_DRAFT_STORE_NAME,
      JSON.stringify({ state: {}, version: 0 }),
    );
    await useSteerDraftStore.persist.rehydrate();
    expect(useSteerDraftStore.getState().drafts).toEqual({});
  });

  it("carries forward a well-formed v1 payload unchanged", async () => {
    localStorage.setItem(
      STEER_DRAFT_STORE_NAME,
      JSON.stringify({
        state: { drafts: { "d1:a": "already there" } },
        version: STEER_DRAFT_STORE_VERSION,
      }),
    );
    await useSteerDraftStore.persist.rehydrate();
    expect(getSteerDraft("d1:a")).toBe("already there");
  });
});
