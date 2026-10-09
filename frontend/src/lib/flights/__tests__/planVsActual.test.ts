import { describe, it, expect } from "vitest";
import { compareEnd, deviationOf, flightPlanActual } from "../planVsActual";
import type { TimeValue, TimePrecision } from "../../../shared/time";
import type { Flight } from "../../../types";

/** A TimeValue as the server sends it — local wall clock, zone, offset, instant. */
function tv(
  local: string,
  utc: string,
  zone: string | null,
  offset: string,
  precision: TimePrecision = "minute"
): TimeValue {
  return { local, utc, zone, offset, precision };
}

const berlin = (local: string, utc: string, offset = "+02:00", p: TimePrecision = "minute") =>
  tv(local, utc, "Europe/Berlin", offset, p);

/** forgejo#216 — plan against record, measured on instants, days read at the place. */
describe("deviationOf", () => {
  it("counts a late departure in minutes", () => {
    const planned = berlin("2026-10-09T12:00:00", "2026-10-09T10:00:00Z");
    const actual = berlin("2026-10-09T12:42:00", "2026-10-09T10:42:00Z");
    expect(deviationOf(planned, actual)).toEqual({ kind: "minutes", minutes: 42 });
  });

  it("counts an early arrival as negative and an exact one as 0", () => {
    const planned = berlin("2026-10-09T12:00:00", "2026-10-09T10:00:00Z");
    expect(deviationOf(planned, berlin("2026-10-09T11:55:00", "2026-10-09T09:55:00Z"))).toEqual({
      kind: "minutes",
      minutes: -5,
    });
    expect(deviationOf(planned, planned)).toEqual({ kind: "minutes", minutes: 0 });
  });

  it("measures the repeated autumn hour on instants, not on the wall clock", () => {
    // 02:40 in the first occurrence (CEST) to 02:10 in the second (CET) on
    // 25 Oct 2026 is 30 minutes LATER, although the clock reads 30 earlier.
    const planned = berlin("2026-10-25T02:40:00", "2026-10-25T00:40:00Z", "+02:00");
    const actual = berlin("2026-10-25T02:10:00", "2026-10-25T01:10:00Z", "+01:00");
    expect(deviationOf(planned, actual)).toEqual({ kind: "minutes", minutes: 30 });
  });

  it("abstains with its reason instead of reporting 0", () => {
    const planned = berlin("2026-10-09T12:00:00", "2026-10-09T10:00:00Z");
    const dayOnly = berlin("2026-10-09T00:00:00", "2026-10-08T22:00:00Z", "+02:00", "day");
    expect(deviationOf(planned, null)).toEqual({ kind: "unknown", reason: "noActual" });
    expect(deviationOf(null, planned)).toEqual({ kind: "unknown", reason: "noPlan" });
    expect(deviationOf(dayOnly, planned)).toEqual({ kind: "unknown", reason: "planNotToMinute" });
    expect(deviationOf(planned, dayOnly)).toEqual({ kind: "unknown", reason: "actualNotToMinute" });
  });
});

describe("compareEnd", () => {
  it("names a landing after midnight as a day later than planned", () => {
    const planned = berlin("2026-10-09T23:30:00", "2026-10-09T21:30:00Z");
    const actual = berlin("2026-10-10T00:20:00", "2026-10-09T22:20:00Z");
    const end = compareEnd(planned, actual);
    expect(end.deviation).toEqual({ kind: "minutes", minutes: 50 });
    expect(end.actualDayShift).toBe(1);
  });

  it("keeps the day shift of a day-only plan, but not its minutes", () => {
    const planned = berlin("2026-10-09T00:00:00", "2026-10-08T22:00:00Z", "+02:00", "day");
    const actual = berlin("2026-10-10T08:00:00", "2026-10-10T06:00:00Z");
    const end = compareEnd(planned, actual);
    expect(end.deviation).toEqual({ kind: "unknown", reason: "planNotToMinute" });
    expect(end.actualDayShift).toBe(1);
  });

  it("claims no day for an unknown-precision value", () => {
    const planned = berlin("2026-10-09T12:00:00", "2026-10-09T10:00:00Z", "+02:00", "unknown");
    const actual = berlin("2026-10-10T08:00:00", "2026-10-10T06:00:00Z");
    expect(compareEnd(planned, actual).actualDayShift).toBeNull();
    expect(compareEnd(planned, null).actualDayShift).toBeNull();
  });
});

function flightWith(times: Flight["times"]): Flight {
  return {
    id: "f1",
    airline: "X",
    flightNumber: "X1",
    departureTime: "",
    arrivalTime: "",
    status: "flown",
    createdAt: "2026-01-01T00:00:00Z",
    times,
  } as unknown as Flight;
}

describe("flightPlanActual", () => {
  it("reads an overnight flight as arriving the next day at the destination", () => {
    const view = flightPlanActual(
      flightWith({
        departure: berlin("2026-10-09T22:30:00", "2026-10-09T20:30:00Z"),
        arrival: tv("2026-10-10T06:10:00", "2026-10-10T02:10:00Z", "Asia/Dubai", "+04:00"),
      })
    );
    expect(view.plannedArrivalDayOffset).toBe(1);
    expect(view.actualArrivalDayOffset).toBeNull();
    expect(view.arrival.deviation).toEqual({ kind: "unknown", reason: "noActual" });
  });

  it("reads a westbound date-line crossing as arriving the previous day", () => {
    const view = flightPlanActual(
      flightWith({
        departure: tv("2026-10-10T10:00:00", "2026-10-10T01:00:00Z", "Asia/Tokyo", "+09:00"),
        arrival: tv("2026-10-09T22:00:00", "2026-10-10T08:00:00Z", "Pacific/Honolulu", "-10:00"),
      })
    );
    expect(view.plannedArrivalDayOffset).toBe(-1);
  });

  it("compares the recorded ends only when both were recorded", () => {
    const view = flightPlanActual(
      flightWith({
        departure: berlin("2026-10-09T22:30:00", "2026-10-09T20:30:00Z"),
        arrival: berlin("2026-10-09T23:40:00", "2026-10-09T21:40:00Z"),
        actualDeparture: berlin("2026-10-09T23:55:00", "2026-10-09T21:55:00Z"),
        actualArrival: berlin("2026-10-10T01:05:00", "2026-10-09T23:05:00Z"),
      })
    );
    expect(view.plannedArrivalDayOffset).toBe(0);
    expect(view.actualArrivalDayOffset).toBe(1);
    expect(view.departure.deviation).toEqual({ kind: "minutes", minutes: 85 });
    expect(view.arrival.deviation).toEqual({ kind: "minutes", minutes: 85 });
    expect(view.arrival.actualDayShift).toBe(1);
  });
});
