/**
 * forgejo#299: "Ein Überflug oder fehlerhafter Standort darf weder
 * Bodenkontakt noch Besuch belegen." Measured on prod on 2026-10-16: Syria and
 * Lebanon from one point each on EK052 MUC–DXB, Romania from 1,686 points on
 * LH718 MUC–ICN, Cape Verde from 111 on LH506 FRA–GRU — every one of them a
 * stored country-day, because the reduction never asked whether the phone was
 * in the cabin.
 *
 * Two rules answer that, and each is tested where the other cannot see:
 * the speed rule on a flight nobody entered, the flight window on a lone point
 * that has no neighbours to be fast against.
 */
import { describe, it, expect } from "@jest/globals";

import { flightTimes, type FlightTimeColumns } from "../../flights/timesDto";
import { airWindowOf, flightAirTimeTest } from "../flightAirTime";
import { knownAirportTest } from "../knownAirports";
import { reduceToCountryDays, type TimedPosition } from "../reduce";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const SEP_10 = Date.UTC(2026, 8, 10);

const MUC = { latitude: 48.3538, longitude: 11.7861 };
const DXB = { latitude: 25.2532, longitude: 55.3657 };
const DOH = { latitude: 25.2731, longitude: 51.6081 };
const HAN = { latitude: 21.2187, longitude: 105.8042 };
const SYRIA = { latitude: 35.0, longitude: 38.5 };
const AUSTRIA = { latitude: 47.6, longitude: 13.0 };

/**
 * A stand-in for the boundary index: a few longitude bands, so the tests
 * read as geography without loading the 10 MB file.
 */
function countryAt(lat: number, lon: number): string | null {
  if (lon < 12.9) return "DE";
  if (lon < 17) return lat > 46 ? "AT" : "IT";
  if (lon < 30) return "RO";
  if (lon < 42) return "SY";
  if (lon < 52) return "QA";
  if (lon < 60) return "AE";
  return "VN";
}

const at = (
  timestampMs: number,
  where: { latitude: number; longitude: number }
): TimedPosition => ({
  timestampMs,
  ...where,
});

/** The countries the speed rule alone lets through — no airports, no flights. */
const countries = (points: TimedPosition[]): string[] =>
  reduceToCountryDays(points, countryAt).map((day) => day.countryCode);

/** `count` points every `stepMinutes` on a straight line between two places. */
function track(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  startMs: number,
  count: number,
  stepMinutes: number
): TimedPosition[] {
  return Array.from({ length: count }, (_, i) => {
    const f = count === 1 ? 0 : i / (count - 1);
    return at(startMs + i * stepMinutes * MINUTE_MS, {
      latitude: from.latitude + (to.latitude - from.latitude) * f,
      longitude: from.longitude + (to.longitude - from.longitude) * f,
    });
  });
}

describe("the speed rule — a flight nobody entered", () => {
  it("makes no Syrian day from the one fix a phone took over Syria on the way to Dubai", () => {
    const days = countries([
      at(SEP_10 + 12 * HOUR_MS, MUC),
      at(SEP_10 + 13 * HOUR_MS, MUC),
      at(SEP_10 + 16 * HOUR_MS, SYRIA),
      at(SEP_10 + 19.5 * HOUR_MS, DXB),
      at(SEP_10 + 21 * HOUR_MS, DXB),
    ]);

    expect(days).toEqual(["AE", "DE"]);
  });

  it("drops a dense cruise track — the 1,686 Romanian points of LH718", () => {
    // 850 km/h, one fix a minute, from Munich to the east.
    const cruise = track(
      { latitude: 46.0, longitude: 13.5 },
      { latitude: 44.0, longitude: 29.5 },
      SEP_10 + 14 * HOUR_MS,
      90,
      1
    );
    const days = countries([
      at(SEP_10 + 13 * HOUR_MS, MUC),
      at(SEP_10 + 13.5 * HOUR_MS, MUC),
      ...cruise,
      // Landing — reached at cruise speed from the last fix, then on the ground.
      at(SEP_10 + 17 * HOUR_MS, SYRIA),
      at(SEP_10 + 17.5 * HOUR_MS, SYRIA),
    ]);

    expect(days).not.toContain("RO");
    expect(days).not.toContain("AT");
  });

  it("keeps the countries a high-speed train crosses at 300 km/h", () => {
    // Ground contact under #299 — the rule removes the cabin, not the carriage.
    const ride = track(
      { latitude: 48.0, longitude: 12.0 },
      { latitude: 48.0, longitude: 16.0 },
      SEP_10 + 8 * HOUR_MS,
      30,
      2
    );

    expect(countries(ride)).toEqual(["AT", "DE"]);
  });

  it("drops a single fix that jumps hundreds of kilometres away and straight back", () => {
    const days = countries([
      at(SEP_10 + 10 * HOUR_MS, MUC),
      at(SEP_10 + 10 * HOUR_MS + 5 * MINUTE_MS, MUC),
      at(SEP_10 + 10 * HOUR_MS + 10 * MINUTE_MS, { latitude: 45.5, longitude: 25.0 }),
      at(SEP_10 + 10 * HOUR_MS + 15 * MINUTE_MS, MUC),
      at(SEP_10 + 10 * HOUR_MS + 20 * MINUTE_MS, MUC),
    ]);

    expect(days).toEqual(["DE"]);
  });

  it("keeps a layover at an airport flown through, though both hops around it are fast", () => {
    // Munich -> Doha -> Hanoi with the phone off in the air: the one Doha fix
    // is far from both neighbours in little time, and still a ground contact.
    const points = [
      at(SEP_10 + 6 * HOUR_MS, MUC),
      at(SEP_10 + 13 * HOUR_MS, DOH),
      at(SEP_10 + 20 * HOUR_MS, HAN),
      at(SEP_10 + 21 * HOUR_MS, HAN),
    ];
    const airports = knownAirportTest([
      { lat: MUC.latitude, lon: MUC.longitude },
      { lat: DOH.latitude, lon: DOH.longitude },
      { lat: HAN.latitude, lon: HAN.longitude },
    ]);

    const days = reduceToCountryDays(points, countryAt, airports).map((d) => d.countryCode);

    expect(days).toContain("QA");
  });
});

describe("the flight window — a lone point with no neighbours to be fast against", () => {
  const window = {
    startMs: SEP_10 + 13 * HOUR_MS,
    endMs: SEP_10 + 20 * HOUR_MS,
    endpointCountries: new Set(["DE", "AE"]),
  };

  it("drops a point in the air time over a country the flight does not land in", () => {
    const lone = [at(SEP_10 + 16 * HOUR_MS, SYRIA)];

    expect(reduceToCountryDays(lone, countryAt)).toHaveLength(1);
    expect(
      reduceToCountryDays(lone, countryAt, undefined, flightAirTimeTest([window]))
    ).toHaveLength(0);
  });

  it("keeps the departure and arrival countries inside the window", () => {
    const points = [
      at(SEP_10 + 13 * HOUR_MS + 10 * MINUTE_MS, MUC),
      at(SEP_10 + 19 * HOUR_MS, DXB),
    ];

    const days = reduceToCountryDays(points, countryAt, undefined, flightAirTimeTest([window]));

    expect(days.map((d) => d.countryCode)).toEqual(["AE", "DE"]);
  });

  it("keeps a point outside every window, wherever it is", () => {
    const later = [at(SEP_10 + 23 * HOUR_MS, SYRIA)];

    expect(
      reduceToCountryDays(later, countryAt, undefined, flightAirTimeTest([window]))
    ).toHaveLength(1);
  });

  it("keeps a hub point where two flights' windows overlap", () => {
    const inbound = { ...window, endpointCountries: new Set(["DE", "QA"]) };
    const outbound = {
      startMs: window.endMs - HOUR_MS,
      endMs: window.endMs + 8 * HOUR_MS,
      endpointCountries: new Set(["QA", "VN"]),
    };

    expect(flightAirTimeTest([inbound, outbound])(window.endMs - 30 * MINUTE_MS, "QA")).toBe(false);
    expect(flightAirTimeTest([inbound, outbound])(window.endMs - 30 * MINUTE_MS, "SY")).toBe(true);
  });
});

describe("airWindowOf — the instants are the real ones, or there is no window", () => {
  const base: FlightTimeColumns = {
    departureTime: null,
    arrivalTime: null,
    depTimeSemantics: "UTC",
    arrTimeSemantics: "UTC",
    depTimezone: "Europe/Berlin",
    arrTimezone: "Asia/Dubai",
    depPrecision: null,
    arrPrecision: null,
    actualDeparture: null,
    actualArrival: null,
    runwayDepartureTime: null,
    runwayArrivalTime: null,
    onlineCheckInOpensAt: null,
    onlineCheckInZone: null,
  };
  const zones = { dep: "Europe/Berlin", arr: "Asia/Dubai" };
  const endpoints = new Set(["DE", "AE"]);

  it("reads a LEGACY_FAKE_UTC flight at its airports' clocks, not as UTC", () => {
    // Stored as wall clocks: 15:25 in Munich (13:25 UTC), 23:35 in Dubai (19:35 UTC).
    const legacy = {
      ...base,
      departureTime: new Date("2026-09-10T15:25:00.000Z"),
      arrivalTime: new Date("2026-09-10T23:35:00.000Z"),
      depTimeSemantics: "LEGACY_FAKE_UTC",
      arrTimeSemantics: "LEGACY_FAKE_UTC",
    };

    const window = airWindowOf(flightTimes(legacy, zones), endpoints);

    expect(window).not.toBeNull();
    // Over Austria twenty minutes after the real take-off. Read as UTC, the
    // window would only open at 14:55 and this fix would make an Austrian day.
    const overAustria = Date.UTC(2026, 8, 10, 13, 45);
    expect(
      flightAirTimeTest([window!])(overAustria, countryAt(AUSTRIA.latitude, AUSTRIA.longitude)!)
    ).toBe(true);
  });

  it("opens no window for a date-only flight — its noon is a placeholder", () => {
    const dateOnly = {
      ...base,
      departureTime: new Date("2026-09-10T10:00:00.000Z"),
      arrivalTime: new Date("2026-09-10T16:00:00.000Z"),
      depTimeSemantics: "DATE_ONLY",
      arrTimeSemantics: "DATE_ONLY",
    };

    expect(airWindowOf(flightTimes(dateOnly, zones), endpoints)).toBeNull();
  });

  it("widens to a recorded actual arrival, so a delay does not leave the end outside", () => {
    const delayed = {
      ...base,
      departureTime: new Date("2026-09-10T13:20:00.000Z"),
      arrivalTime: new Date("2026-09-10T19:30:00.000Z"),
      actualArrival: new Date("2026-09-10T22:00:00.000Z"),
    };

    const window = airWindowOf(flightTimes(delayed, zones), endpoints);

    expect(window!.endMs).toBeGreaterThanOrEqual(Date.UTC(2026, 8, 10, 22, 0));
  });

  it("opens no window for a span no flight lasts", () => {
    const wrongDate = {
      ...base,
      departureTime: new Date("2026-09-10T13:20:00.000Z"),
      arrivalTime: new Date("2026-09-12T19:30:00.000Z"),
    };

    expect(airWindowOf(flightTimes(wrongDate, zones), endpoints)).toBeNull();
  });
});
