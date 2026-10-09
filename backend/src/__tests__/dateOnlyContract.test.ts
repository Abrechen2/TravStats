/**
 * forgejo#273 — the DATE_ONLY flight contract, written through the REAL writer.
 *
 * A date-only flight is not stored as 12:00Z of its day. The historical form
 * sends `YYYY-MM-DDT12:00` and the cruise import `YYYY-MM-DDT00:00`, each with
 * the airport's zone, and the server converts that wall clock through the zone
 * (`toUtcDate`). So the day is the LOCAL day of the stored instant in that zone
 * — for AKL in summer, Tonga, Kiritimati and every cruise-import flight east of
 * UTC, the stored UTC date is the day BEFORE. A first attempt at this issue
 * read DATE_ONLY rows on their stored UTC components and was reverted for
 * exactly that; its fixtures had planted `T12:00:00Z`, a value no writer
 * produces, which is why they could not see it.
 *
 * The cases live in `shared/time/dateOnlyFlights.json`, which the web mirror's
 * suite reads too. Every statistic that names a flight's day is asked here.
 */
import fs from "fs";
import path from "path";

import { toUtcDate } from "../services/flights/mergedChronology";
import { localWallClockOf } from "../utils/timezone";
import { departureDayOf } from "../utils/stats/departureClock";
import { airportCalendarDay } from "../services/stats/departureClock";
import { calculateFunStats } from "../utils/stats/funStats";
import { computeCountryStats } from "../services/stats/countryStats";
import { buildTravelRecords, type RecordFlightInput } from "../services/stats/records";
import { computeFlightSequenceStats } from "../utils/flightSequenceStats";
import type { FlightData as StatsFlight } from "../utils/stats/types";
import type { FlightData as SequenceFlight } from "../utils/achievementStats";

interface DateOnlyCase {
  id: string;
  writer: "form" | "cruiseImport";
  iata: string;
  zone: string;
  day: string;
  local: string;
  stored: string;
}

const VECTOR_PATH = path.resolve(__dirname, "../../../shared/time/dateOnlyFlights.json");
const CASES = (JSON.parse(fs.readFileSync(VECTOR_PATH, "utf8")) as { cases: DateOnlyCase[] }).cases;

jest.mock("../services/airportCache", () => {
  const actual = jest.requireActual("../services/airportCache");
  const zones: Record<string, string> = {
    AKL: "Pacific/Auckland",
    TBU: "Pacific/Tongatapu",
    CXI: "Pacific/Kiritimati",
    FRA: "Europe/Berlin",
    MIA: "America/New_York",
  };
  return {
    ...actual,
    getCachedAirports: jest.fn(
      async (codes: string[]) =>
        new Map(
          codes
            .filter((c) => zones[c])
            .map((c) => [c, { country: `country-${c}`, timezone: zones[c] }])
        )
    ),
  };
});

/** The writer's instant — asserted against the vector, so a writer change fails here first. */
const written = (c: DateOnlyCase): Date => toUtcDate(c.local, c.zone) as Date;

/** A timed departure later on the same local day, so a day grouping is observable. */
const sameDayTimed = (c: DateOnlyCase): Date => toUtcDate(`${c.day}T15:00`, c.zone) as Date;

describe.each(CASES)("DATE_ONLY $id ($writer, $zone) stays on $day", (c) => {
  it("is what the server writer stores", () => {
    expect(written(c).toISOString()).toBe(c.stored);
  });

  it("reads back on the recorded day through its zone, with no hour", () => {
    const clock = localWallClockOf(written(c), c.zone, "DATE_ONLY");
    expect(clock.date).toBe(c.day);
    expect(clock.hour).toBeNull();
    expect(
      departureDayOf({
        departureTime: written(c),
        depTimezone: c.zone,
        depTimeSemantics: "DATE_ONLY",
      })
    ).toBe(c.day);
  });

  it("buckets the time series on that day", () => {
    expect(airportCalendarDay(written(c), c.zone, "DATE_ONLY").toISOString().slice(0, 10)).toBe(
      c.day
    );
  });

  it("is the busiest day and counts in that year (fun stats)", async () => {
    const statsFlight = (id: string, departureTime: Date, dateOnly: boolean): StatsFlight => ({
      id,
      status: dateOnly ? "historical" : "flown",
      depIata: c.iata,
      arrIata: c.iata,
      depIcao: null,
      arrIcao: null,
      depLat: 0,
      depLon: 0,
      arrLat: 0,
      arrLon: 0,
      departureTime,
      arrivalTime: departureTime,
      depTimezone: c.zone,
      depTimeSemantics: dateOnly ? "DATE_ONLY" : "UTC",
      createdAt: new Date(0),
    });
    const stats = await calculateFunStats([
      statsFlight("a", written(c), true),
      statsFlight("b", sameDayTimed(c), false),
    ]);
    expect(stats.fastestDay).toBe(c.day);
    expect(stats.fastestDayFlights).toBe(2);
    expect(stats.milestoneYear).toBe(Number(c.day.slice(0, 4)));
  });

  it("files its country under the recorded year", async () => {
    const result = await computeCountryStats([
      {
        depIata: c.iata,
        depIcao: null,
        arrIata: c.iata,
        arrIcao: null,
        departureTime: written(c),
        depTimeSemantics: "DATE_ONLY",
      },
    ]);
    expect(Object.keys(result.byYear)).toEqual([c.day.slice(0, 4)]);
  });

  it("is the busiest day in the records", () => {
    const recordFlight = (
      id: string,
      departureTime: Date,
      dateOnly: boolean
    ): RecordFlightInput => ({
      id,
      flightNumber: null,
      depIata: c.iata,
      arrIata: c.iata,
      depLat: 0,
      depLon: 0,
      arrLat: 0,
      arrLon: 0,
      departureTime,
      durationMinutes: null,
      delayMinutes: null,
      routeDistance: null,
      status: dateOnly ? "historical" : "flown",
      depTimezone: c.zone,
      depTimeSemantics: dateOnly ? "DATE_ONLY" : "UTC",
    });
    const busiest = buildTravelRecords([
      recordFlight("a", written(c), true),
      recordFlight("b", sameDayTimed(c), false),
    ]).find((r) => r.id === "busiest-day");
    expect(busiest?.value).toBe(2);
    expect(busiest?.date).toBe(c.day);
  });

  it("joins the timed flight of its day for the sequence badges", () => {
    const sequenceFlight = (departureTime: Date, dateOnly: boolean): SequenceFlight => ({
      id: `${c.id}-${dateOnly}`,
      depLat: 0,
      depLon: 0,
      arrLat: 0,
      arrLon: 0,
      depIcao: null,
      depIata: c.iata,
      arrIcao: null,
      arrIata: c.iata,
      airline: null,
      aircraft: null,
      flightNumber: null,
      seatNumber: null,
      seatClass: null,
      notes: null,
      actualDeparture: null,
      delayMinutes: null,
      departureTime,
      arrivalTime: null,
      depTimezone: c.zone,
      depTimeSemantics: dateOnly ? "DATE_ONLY" : "UTC",
      status: dateOnly ? "historical" : "flown",
      specialType: null,
    });
    const stats = computeFlightSequenceStats([
      sequenceFlight(written(c), true),
      sequenceFlight(sameDayTimed(c), false),
    ]);
    expect(stats.maxFlightsOneDay).toBe(2);
  });
});
