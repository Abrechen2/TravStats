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
  // `flown` is the retired spelling of `completed` (#357): a stray legacy row
  // still counts until the sweep converges it.
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

  it("lists today's word first and the legacy spelling last", () => {
    expect([...COUNTABLE_CRUISE_STATUSES]).toEqual(["completed", "historical", "flown"]);
    expect(countableCruiseWhere()).toEqual({
      status: { in: ["completed", "historical", "flown"] },
    });
  });

  // A shared constant handed to every caller is one array under many aliases;
  // the first caller that mutates it changes the rest in silence.
  it("hands out a fresh object each call", () => {
    const a = countableCruiseWhere();
    const b = countableCruiseWhere();
    expect(a).not.toBe(b);
    a.status.in.push("cancelled");
    expect(b.status.in).toEqual(["completed", "historical", "flown"]);
  });
});
