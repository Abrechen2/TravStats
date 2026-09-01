import { describe, expect, it } from "vitest";

import { isCountableFlight, isCountableFlightStatus } from "../flightCounting";

/**
 * The SAME truth table the backend asserts in
 * `backend/src/shared/__tests__/flightCounting.test.ts`. Kept case-for-case on
 * purpose: the mirror is only worth having if a one-sided change fails here.
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

  /** Pins today's behaviour, which is not the same as endorsing it — the
   *  backend header carries the open product question. */
  it("excludes duplicated — today's behaviour, and an open product question", () => {
    expect(isCountableFlightStatus("duplicated")).toBe(false);
  });

  it("excludes anything outside the known vocabulary", () => {
    expect(isCountableFlightStatus("")).toBe(false);
    expect(isCountableFlightStatus("in_progress")).toBe(false);
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
