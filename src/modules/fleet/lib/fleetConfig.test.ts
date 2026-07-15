import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAEMON_URL,
  type DaemonConnection,
  migrateConnections,
  pickNextActive,
} from "./fleetConfig";

const seqId = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe("migrateConnections", () => {
  it("migrates the legacy scalar URL into a one-element list, active, when no list exists yet", () => {
    const result = migrateConnections({
      legacyUrl: "http://10.0.0.5:7878",
      existingConnections: null,
      existingActiveId: null,
      newId: seqId(),
    });

    expect(result.dirty).toBe(true);
    expect(result.connections).toEqual([
      { id: "id-1", label: "Local daemon", baseUrl: "http://10.0.0.5:7878" },
    ]);
    expect(result.activeId).toBe("id-1");
  });

  it("never orphans the user's configured legacy URL — it always lands in the migrated list", () => {
    const result = migrateConnections({
      legacyUrl: "https://fleet.example.com",
      existingConnections: null,
      existingActiveId: null,
      newId: seqId(),
    });
    expect(result.connections.map((c) => c.baseUrl)).toContain(
      "https://fleet.example.com",
    );
  });

  it("seeds a default local connection when neither a list nor a legacy URL exists (fresh install)", () => {
    const result = migrateConnections({
      legacyUrl: null,
      existingConnections: null,
      existingActiveId: null,
      newId: seqId(),
    });

    expect(result.dirty).toBe(true);
    expect(result.connections).toEqual([
      { id: "id-1", label: "Local daemon", baseUrl: DEFAULT_DAEMON_URL },
    ]);
    expect(result.activeId).toBe("id-1");
  });

  it("treats an empty-string legacy URL the same as absent (seeds the default, doesn't create a blank entry)", () => {
    const result = migrateConnections({
      legacyUrl: "",
      existingConnections: null,
      existingActiveId: null,
      newId: seqId(),
    });
    expect(result.connections).toEqual([
      { id: "id-1", label: "Local daemon", baseUrl: DEFAULT_DAEMON_URL },
    ]);
  });

  it("is idempotent — leaves an already-migrated list + valid active id untouched", () => {
    const existing: DaemonConnection[] = [
      { id: "a", label: "Local daemon", baseUrl: "http://127.0.0.1:7878" },
      { id: "b", label: "Remote", baseUrl: "https://fleet.example.com" },
    ];
    const result = migrateConnections({
      legacyUrl: "http://ignored:1234",
      existingConnections: existing,
      existingActiveId: "b",
      newId: seqId(),
    });

    expect(result.dirty).toBe(false);
    expect(result.connections).toBe(existing);
    expect(result.activeId).toBe("b");
  });

  it("repairs a stale/missing active id by falling back to the first connection", () => {
    const existing: DaemonConnection[] = [
      { id: "a", label: "Local daemon", baseUrl: "http://127.0.0.1:7878" },
      { id: "b", label: "Remote", baseUrl: "https://fleet.example.com" },
    ];

    const missingActive = migrateConnections({
      existingConnections: existing,
      existingActiveId: "does-not-exist",
      newId: seqId(),
    });
    expect(missingActive.dirty).toBe(true);
    expect(missingActive.activeId).toBe("a");

    const noActive = migrateConnections({
      existingConnections: existing,
      existingActiveId: null,
      newId: seqId(),
    });
    expect(noActive.dirty).toBe(true);
    expect(noActive.activeId).toBe("a");
  });

  it("does not consult the legacy URL once a connections list already exists", () => {
    const existing: DaemonConnection[] = [
      { id: "a", label: "Local daemon", baseUrl: "http://127.0.0.1:7878" },
    ];
    const result = migrateConnections({
      legacyUrl: "http://should-be-ignored:9999",
      existingConnections: existing,
      existingActiveId: "a",
      newId: seqId(),
    });
    expect(result.connections).toEqual(existing);
    expect(result.connections.some((c) => c.baseUrl.includes("9999"))).toBe(
      false,
    );
  });
});

describe("pickNextActive", () => {
  it("picks the first remaining connection", () => {
    const remaining: DaemonConnection[] = [
      { id: "b", label: "Remote", baseUrl: "https://fleet.example.com" },
      { id: "c", label: "Other", baseUrl: "https://other.example.com" },
    ];
    expect(pickNextActive(remaining)).toBe("b");
  });

  it("returns null when nothing remains (removed the last daemon)", () => {
    expect(pickNextActive([])).toBeNull();
  });
});
