import { describe, expect, it } from "vitest";
import { planKeyValueMigration } from "./keyValueMigration";

describe("planKeyValueMigration", () => {
  it("copies the old value to new when only the old key has data", () => {
    const plan = planKeyValueMigration(null, "old-value");
    expect(plan).toEqual({
      value: "old-value",
      shouldWriteNew: true,
      shouldDeleteOld: true,
    });
  });

  it("is a no-op when neither key has data", () => {
    const plan = planKeyValueMigration(null, null);
    expect(plan).toEqual({
      value: null,
      shouldWriteNew: false,
      shouldDeleteOld: false,
    });
  });

  it("prefers the new value when both keys have data (new wins)", () => {
    const plan = planKeyValueMigration("new-value", "old-value");
    expect(plan).toEqual({
      value: "new-value",
      shouldWriteNew: false,
      shouldDeleteOld: false,
    });
  });

  it("is idempotent — running again after a migration is a no-op", () => {
    const first = planKeyValueMigration(null, "old-value");
    expect(first.shouldWriteNew).toBe(true);
    // Simulate the state after the migration ran: new now has the value,
    // old was cleared.
    const second = planKeyValueMigration(first.value, null);
    expect(second).toEqual({
      value: "old-value",
      shouldWriteNew: false,
      shouldDeleteOld: false,
    });
  });

  it("treats an empty string as present data, not absence", () => {
    // Distinguishes "key exists but empty" from "key absent" (null) — callers
    // that only ever store non-empty values won't hit this, but the decision
    // function itself must not conflate the two.
    const plan = planKeyValueMigration("", "old-value");
    expect(plan.shouldWriteNew).toBe(false);
    expect(plan.value).toBe("");
  });
});
