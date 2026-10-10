import { describe, it, expect } from "vitest";
import {
  COUNTABLE_CRUISE_STATUSES,
  isCountableCruise,
  isCountableCruiseStatus,
} from "../cruiseCounting";

/**
 * The truth table, asserted here and asserted again in the frontend mirror's
 * own test. Nothing checks that the two files agree — this pair of tests is the
 * convention that keeps them honest.
 */
describe("cruise counting rule", () => {
  it.each(["completed", "historical", "flown"])("counts %s — the voyage happened", (status) => {
    expect(isCountableCruiseStatus(status)).toBe(true);
  });

  it.each(["scheduled", "cancelled", "duplicated", "", "FLOWN"])("does not count %s", (status) => {
    expect(isCountableCruiseStatus(status)).toBe(false);
  });

  it("reads the status off a row", () => {
    expect(isCountableCruise({ status: "completed" })).toBe(true);
    expect(isCountableCruise({ status: "cancelled" })).toBe(false);
  });

  // `flown` is the retired spelling of `completed` (#357), kept last.
  it("lists today's word first and the legacy spelling last", () => {
    expect([...COUNTABLE_CRUISE_STATUSES]).toEqual(["completed", "historical", "flown"]);
  });
});
