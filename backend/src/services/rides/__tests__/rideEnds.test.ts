import { LocalTimeNonexistentError, TzUnresolvedError } from "../../../shared/time/errors";
import { assertArrivalNotBefore, resolveDistance, resolveEnd } from "../rideEnds";

const SEOUL = "Asia/Seoul";
const BERLIN = "Europe/Berlin";
const none = { fold: undefined, stopMoved: false, stored: null } as const;

describe("resolveEnd", () => {
  it("reads a sent clock in the stop's zone", () => {
    const end = resolveEnd({
      ...none,
      sent: "2026-09-20T09:00",
      zone: SEOUL,
      field: "departureLocal",
    });
    expect(end).toEqual({ time: new Date("2026-09-20T00:00:00Z"), precision: "minute" });
  });

  it("reads the repeated autumn hour as the later pass only when asked", () => {
    // Berlin falls back on 2026-10-25: 02:30 happens twice, 00:30Z (CEST) then 01:30Z (CET).
    const at = (fold: "earlier" | "later" | undefined): Date =>
      resolveEnd({
        ...none,
        fold,
        sent: "2026-10-25T02:30",
        zone: BERLIN,
        field: "departureLocal",
      }).time;
    expect(at("later").toISOString()).toBe("2026-10-25T01:30:00.000Z");
    expect(at("earlier").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(at(undefined).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("refuses a sent clock in a skipped hour", () => {
    expect(() =>
      resolveEnd({ ...none, sent: "2027-03-28T02:30", zone: BERLIN, field: "departureLocal" })
    ).toThrow(LocalTimeNonexistentError);
  });

  it("turns a sent day into the start of that day there, precision day", () => {
    const end = resolveEnd({ ...none, sent: "2026-09-21", zone: SEOUL, field: "arrivalLocal" });
    expect(end).toEqual({ time: new Date("2026-09-20T15:00:00Z"), precision: "day" });
  });

  it("keeps a stored end that was neither re-sent nor moved", () => {
    const time = new Date("2026-09-20T00:00:00Z");
    const end = resolveEnd({
      sent: undefined,
      fold: undefined,
      zone: SEOUL,
      stopMoved: false,
      stored: { time, zone: SEOUL, precision: "minute" },
      field: "departureLocal",
    });
    expect(end).toEqual({ time, precision: "minute" });
  });

  it("re-reads a stored end's clock in the new zone when its stop moved", () => {
    const end = resolveEnd({
      sent: undefined,
      fold: undefined,
      zone: BERLIN,
      stopMoved: true,
      stored: { time: new Date("2026-09-20T00:00:00Z"), zone: SEOUL, precision: "minute" },
      field: "departureLocal",
    });
    expect(end?.time.toISOString()).toBe("2026-09-20T07:00:00.000Z");
  });

  it.each(["minute", "day"])("refuses a moved %s end whose new stop has no zone", (precision) => {
    expect(() =>
      resolveEnd({
        sent: undefined,
        fold: undefined,
        zone: null,
        stopMoved: true,
        stored: { time: new Date("2026-09-20T00:00:00Z"), zone: SEOUL, precision },
        field: "arrivalLocal",
      })
    ).toThrow(TzUnresolvedError);
  });
});

describe("assertArrivalNotBefore", () => {
  const departure = { time: new Date("2026-09-20T11:20:00Z"), precision: "minute" as const };
  const early = { time: new Date("2026-09-20T11:00:00Z"), precision: "minute" as const };

  it.each(["RAIL_ARRIVAL_BEFORE_DEPARTURE", "BUS_ARRIVAL_BEFORE_DEPARTURE"] as const)(
    "refuses an earlier arrival with %s on arrivalLocal",
    (code) => {
      expect(() => assertArrivalNotBefore(departure, SEOUL, early, SEOUL, code)).toThrow(
        expect.objectContaining({ code, field: "arrivalLocal" })
      );
    }
  );

  it("compares days when an end has no clock", () => {
    const day = { time: new Date("2026-09-19T15:00:00Z"), precision: "day" as const };
    expect(() =>
      assertArrivalNotBefore(
        day,
        SEOUL,
        { ...early, time: new Date("2026-09-20T00:00:00Z") },
        SEOUL,
        "BUS_ARRIVAL_BEFORE_DEPARTURE"
      )
    ).not.toThrow();
  });
});

describe("resolveDistance", () => {
  const coords = { depLat: 0, depLon: 0, arrLat: 0, arrLon: 1 };

  it("keeps a typed distance, even a typed zero, until it is cleared", () => {
    const typed = { distanceKm: 0, distanceSource: "user" };
    expect(resolveDistance(typed, {}, coords)).toEqual({ distanceKm: 0, distanceSource: "user" });
    expect(resolveDistance(typed, { distanceKm: null }, coords).distanceSource).toBe(
      "great_circle"
    );
  });
});
