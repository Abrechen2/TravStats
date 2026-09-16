import {
  COUNTABLE_CRUISE_STATUSES,
  countableCruiseWhere,
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

  it.each(["scheduled", "cancelled", "duplicated", "", "FLOWN"])(
    "does not count %s",
    (status) => {
      expect(isCountableCruiseStatus(status)).toBe(false);
    },
  );

  it("reads the status off a row", () => {
    expect(isCountableCruise({ status: "flown" })).toBe(true);
    expect(isCountableCruise({ status: "cancelled" })).toBe(false);
  });

  // The order is load-bearing: every call site this replaced spelled it
  // flown-then-historical, so a query plan or snapshot must see no change.
  it("keeps the flown-then-historical order the call sites had", () => {
    expect([...COUNTABLE_CRUISE_STATUSES]).toEqual(["flown", "historical"]);
    expect(countableCruiseWhere()).toEqual({ status: { in: ["flown", "historical"] } });
  });

  // A shared constant handed to every caller is one array under many aliases;
  // the first caller that mutates it changes the rest in silence.
  it("hands out a fresh object each call", () => {
    const a = countableCruiseWhere();
    const b = countableCruiseWhere();
    expect(a).not.toBe(b);
    a.status.in.push("cancelled");
    expect(b.status.in).toEqual(["flown", "historical"]);
  });
});
