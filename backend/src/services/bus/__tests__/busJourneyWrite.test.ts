import { AppError } from "../../../middleware/errorHandler";
import { LocalTimeNonexistentError, TzUnresolvedError } from "../../../shared/time/errors";
import { mergeBusJourney, terminalColumns } from "../busJourneyWrite";

const SEOUL = {
  name: "Seoul Express Bus Terminal",
  address: null,
  lat: 37.5048,
  lon: 127.0046,
  country: "KR",
};
const SOKCHO = {
  name: "Sokcho Express Bus Terminal",
  address: null,
  lat: 38.1911,
  lon: 128.5918,
  country: "KR",
};
const BERLIN_ZOB = {
  name: "ZOB Berlin",
  address: "Masurenallee 4-6",
  lat: 52.5069,
  lon: 13.2778,
  country: "DE",
};
// geo-tz answers every point ON the globe (open water gets an Etc/GMT±N zone), so the only
// coordinate with no zone is one off the globe — what a stored row from before validation could hold.
const NO_ZONE = { name: "Nowhere", address: null, lat: 91, lon: 0, country: null };

describe("terminalColumns", () => {
  it("derives the zone from the coordinates and keeps the address", () => {
    expect(terminalColumns("dep", BERLIN_ZOB)).toEqual({
      depStationName: "ZOB Berlin",
      depAddress: "Masurenallee 4-6",
      depLat: 52.5069,
      depLon: 13.2778,
      depCountry: "DE",
      depTimezone: "Europe/Berlin",
    });
  });
});

describe("mergeBusJourney", () => {
  const now = new Date("2026-10-01T00:00:00Z");

  it("reads each wall clock on its terminal's zone and measures the straight line", () => {
    const state = mergeBusJourney(
      null,
      {
        departureStation: SEOUL,
        arrivalStation: SOKCHO,
        departureLocal: "2026-09-20T09:00",
        arrivalLocal: "2026-09-20T11:20",
        status: "scheduled",
      },
      now
    );
    expect(state.departureTime.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(state.arrivalTime?.toISOString()).toBe("2026-09-20T02:20:00.000Z");
    expect(state.depPrecision).toBe("minute");
    expect(state.distanceSource).toBe("great_circle");
    expect(state.distanceKm).toBeGreaterThan(150);
    expect(state.distanceKm).toBeLessThan(170);
    expect(state.status).toBe("completed");
  });

  it("compares instants, not wall clocks (Paris 10:00 → London 10:55 is a real ride)", () => {
    const PARIS = { name: "Paris Bercy", address: null, lat: 48.8389, lon: 2.3829, country: "FR" };
    const LONDON = {
      name: "London Victoria Coach Station",
      address: null,
      lat: 51.4925,
      lon: -0.1481,
      country: "GB",
    };
    const state = mergeBusJourney(
      null,
      {
        departureStation: PARIS,
        arrivalStation: LONDON,
        departureLocal: "2026-07-01T10:00",
        arrivalLocal: "2026-07-01T10:55",
        status: "scheduled",
      },
      now
    );
    expect(state.arrivalTime!.getTime()).toBeGreaterThan(state.departureTime.getTime());
  });

  it("refuses an arrival before the departure as instants", () => {
    expect(() =>
      mergeBusJourney(
        null,
        {
          departureStation: SEOUL,
          arrivalStation: SOKCHO,
          departureLocal: "2026-09-20T11:20",
          arrivalLocal: "2026-09-20T11:00",
          status: "scheduled",
        },
        now
      )
    ).toThrow(
      expect.objectContaining({ code: "BUS_ARRIVAL_BEFORE_DEPARTURE", field: "arrivalLocal" })
    );
  });

  it("refuses a wall clock in a spring-forward gap", () => {
    expect(() =>
      mergeBusJourney(
        null,
        {
          departureStation: BERLIN_ZOB,
          arrivalStation: BERLIN_ZOB,
          departureLocal: "2027-03-28T02:30",
          status: "scheduled",
        },
        now
      )
    ).toThrow(LocalTimeNonexistentError);
  });

  it("refuses a terminal without a zone instead of reading the clock as UTC", () => {
    expect(() =>
      mergeBusJourney(
        null,
        {
          departureStation: NO_ZONE,
          arrivalStation: SOKCHO,
          departureLocal: "2026-09-20T09:00",
          status: "scheduled",
        },
        now
      )
    ).toThrow(TzUnresolvedError);
  });

  it("a day-only ride is stored at the start of its day with precision day, no delay allowed", () => {
    const state = mergeBusJourney(
      null,
      {
        departureStation: SEOUL,
        arrivalStation: SOKCHO,
        departureLocal: "2026-09-21",
        status: "scheduled",
      },
      now
    );
    expect(state.departureTime.toISOString()).toBe("2026-09-20T15:00:00.000Z");
    expect(state.depPrecision).toBe("day");
    expect(state.arrivalTime).toBeNull();
    expect(() =>
      mergeBusJourney(
        null,
        {
          departureStation: SEOUL,
          arrivalStation: SOKCHO,
          departureLocal: "2026-09-21",
          delayMinutes: 5,
          status: "scheduled",
        },
        now
      )
    ).toThrow(AppError);
  });

  it("a moved terminal keeps the ticket's clock and moves the instant with the zone", () => {
    const existing = mergeBusJourney(
      null,
      {
        departureStation: SEOUL,
        arrivalStation: SOKCHO,
        departureLocal: "2026-09-20T09:00",
        status: "scheduled",
      },
      now
    );
    // Only the departure terminal changes — to Berlin, six/seven hours behind Seoul.
    const moved = mergeBusJourney(existing, { departureStation: BERLIN_ZOB }, now);
    expect(moved.depTimezone).toBe("Europe/Berlin");
    // Still 09:00 on the ticket, now Berlin's 09:00 (07:00Z in September).
    expect(moved.departureTime.toISOString()).toBe("2026-09-20T07:00:00.000Z");
  });

  it("a typed distance is kept until cleared; null measures again", () => {
    const typed = mergeBusJourney(
      null,
      {
        departureStation: SEOUL,
        arrivalStation: SOKCHO,
        departureLocal: "2026-09-20T09:00",
        distanceKm: 210,
        status: "scheduled",
      },
      now
    );
    expect(typed).toMatchObject({ distanceKm: 210, distanceSource: "user" });
    expect(mergeBusJourney(typed, { seat: "12A" }, now)).toMatchObject({
      distanceKm: 210,
      distanceSource: "user",
    });
    expect(mergeBusJourney(typed, { distanceKm: null }, now).distanceSource).toBe("great_circle");
  });
});
