import { describe, it, expect } from "vitest";
import { buildTimelineEvents, type TimelineEvent } from "../tripTimelineEvents";
import { formatTimelineDate } from "../tripTimeline";
import type { Trip } from "../../types";

/**
 * The trip timeline groups by the PLACE's day (ADR 0002, phase 4).
 *
 * Reported on the time-model review: a flight leaving Haneda at 01:00 on
 * 1 August appeared under 31 July, because at that instant it was still the
 * 31st in UTC — and the 31st's diary entry, which closes its day, was drawn
 * AFTER the flight that began the next one. What the user sees is the order of
 * the entries and the date printed on each; both are asserted here.
 */
type TripFlight = NonNullable<Trip["flights"]>[number];

const hndMuc = {
  id: "f1",
  depIata: "HND",
  arrIata: "MUC",
  departureTime: "2026-07-31T16:00:00.000Z",
  arrivalTime: "2026-08-01T04:25:00.000Z",
  depTimezone: "Asia/Tokyo",
  arrTimezone: "Europe/Berlin",
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
} as TripFlight;

const withTimes: TripFlight = {
  ...hndMuc,
  times: {
    departure: {
      utc: "2026-07-31T16:00:00.000Z",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      local: "2026-08-01T01:00:00",
      precision: "minute",
    },
    arrival: {
      utc: "2026-08-01T04:25:00.000Z",
      zone: "Europe/Berlin",
      offset: "+02:00",
      local: "2026-08-01T06:25:00",
      precision: "minute",
    },
  },
};

function trip(flight: TripFlight): Trip {
  return {
    id: "t1",
    flights: [flight],
    cruises: [],
    stops: [],
    journalEntries: [
      {
        id: "j1",
        tripId: "t1",
        date: "2026-07-31T00:00:00.000Z",
        title: "Letzter Abend in Tokio",
        body: "",
        mood: null,
        weather: null,
        createdAt: "",
        updatedAt: "",
      },
    ],
  } as unknown as Trip;
}

/** What the timeline draws: each entry's kind and the date text on its card. */
const shown = (events: TimelineEvent[]) => events.map((e) => [e.kind, formatTimelineDate(e.when)]);

describe("trip timeline — grouped by the place's day", () => {
  it("puts a Haneda departure at 01:00 on 1 August after the 31st's diary entry", () => {
    expect(shown(buildTimelineEvents(trip(withTimes), []))).toEqual([
      ["journal", "31.07.2026"],
      ["flight", "01.08.2026 01:00"],
    ]);
  });

  it("prints both ends on their airports' clocks", () => {
    const [, flight] = buildTimelineEvents(trip(withTimes), []);
    expect(flight.kind === "flight" && flight.subtitle).toBe("01.08.2026 01:00 → 01.08.2026 06:25");
  });

  it("reads a payload without `times` the same way, from the airports' stored zones", () => {
    expect(shown(buildTimelineEvents(trip(hndMuc), []))).toEqual([
      ["journal", "31.07.2026"],
      ["flight", "01.08.2026 01:00"],
    ]);
  });

  it("labels a flight whose airport has no zone as UTC instead of guessing one", () => {
    const events = buildTimelineEvents(
      trip({ ...hndMuc, depTimezone: null, arrTimezone: null }),
      []
    );
    const flight = events.find((e) => e.kind === "flight");
    expect(flight?.kind === "flight" && flight.subtitle).toBe(
      "31.07.2026 16:00 UTC → 01.08.2026 04:25 UTC"
    );
  });
});
