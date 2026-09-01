import {
  COUNTABLE_FLIGHT_STATUSES,
  countableFlightWhere,
  isCountableFlight,
  isCountableFlightStatus,
} from "../flightCounting";
import { FLIGHT_PASSTHROUGH } from "../statusDerivation";

/**
 * Truth table over the WHOLE flight status vocabulary, not just the two that
 * count. A refactor that quietly widened the rule would pass a test listing
 * only `flown` and `historical`; it fails the `duplicated` case below.
 *
 * The frontend mirror (`frontend/src/shared/__tests__/flightCounting.test.ts`)
 * asserts the same cases — if one side is changed alone, the two disagree here.
 */
const ALL_FLIGHT_STATUSES = [
  "scheduled",
  "flown",
  "cancelled",
  "historical",
  "duplicated",
] as const;

describe("isCountableFlightStatus", () => {
  it.each(["flown", "historical"])("counts %s — it happened", (status) => {
    expect(isCountableFlightStatus(status)).toBe(true);
  });

  it.each(["scheduled", "cancelled"])("excludes %s — it did not happen", (status) => {
    expect(isCountableFlightStatus(status)).toBe(false);
  });

  /**
   * Pins TODAY's behaviour, which is not the same as endorsing it. Whether a
   * duplicated row should count is the open product question in the module
   * header; until someone answers it, this test is what stops the answer from
   * changing by accident.
   */
  it("excludes duplicated — today's behaviour, and an open product question", () => {
    expect(isCountableFlightStatus("duplicated")).toBe(false);
  });

  it("excludes anything outside the known vocabulary", () => {
    expect(isCountableFlightStatus("")).toBe(false);
    expect(isCountableFlightStatus("in_progress")).toBe(false);
  });

  it("has an opinion on every status a flight can carry", () => {
    for (const status of ALL_FLIGHT_STATUSES) {
      expect(typeof isCountableFlightStatus(status)).toBe("boolean");
    }
    // Every status the deriver passes through untouched is either history the
    // user asserted or a state the calendar cannot judge. Two of the three are
    // excluded here; `historical` is the one that counts.
    expect(FLIGHT_PASSTHROUGH.filter(isCountableFlightStatus)).toEqual(["historical"]);
  });
});

describe("isCountableFlight", () => {
  it("reads the status off a row", () => {
    expect(isCountableFlight({ status: "flown" })).toBe(true);
    expect(isCountableFlight({ status: "scheduled" })).toBe(false);
  });

  it("works as a bare `.filter` argument", () => {
    const rows = ALL_FLIGHT_STATUSES.map((status) => ({ status }));
    expect(rows.filter(isCountableFlight).map((r) => r.status)).toEqual(["flown", "historical"]);
  });
});

describe("countableFlightWhere", () => {
  it("produces the same fragment the call sites used to write by hand", () => {
    expect(countableFlightWhere()).toEqual({ status: { in: ["flown", "historical"] } });
  });

  it("hands out a fresh object each call, so no caller can poison another", () => {
    const a = countableFlightWhere();
    const b = countableFlightWhere();
    expect(a).not.toBe(b);
    expect(a.status.in).not.toBe(b.status.in);
    a.status.in.push("cancelled");
    expect(b.status.in).toEqual([...COUNTABLE_FLIGHT_STATUSES]);
  });

  it("spreads into a larger where without clobbering its siblings", () => {
    expect({ userId: "u1", ...countableFlightWhere() }).toEqual({
      userId: "u1",
      status: { in: ["flown", "historical"] },
    });
  });
});
