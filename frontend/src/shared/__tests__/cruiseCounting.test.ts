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
  it.each(["flown", "historical"])("counts %s — the voyage happened", (status) => {
    expect(isCountableCruiseStatus(status)).toBe(true);
  });

  it.each(["scheduled", "cancelled", "duplicated", "", "FLOWN"])("does not count %s", (status) => {
    expect(isCountableCruiseStatus(status)).toBe(false);
  });

  it("reads the status off a row", () => {
    expect(isCountableCruise({ status: "flown" })).toBe(true);
    expect(isCountableCruise({ status: "cancelled" })).toBe(false);
  });

  // The order is load-bearing: every call site this replaced spelled it
  // flown-then-historical, and the backend mirror turns it into a query.
  it("keeps the flown-then-historical order the call sites had", () => {
    expect([...COUNTABLE_CRUISE_STATUSES]).toEqual(["flown", "historical"]);
  });
});
