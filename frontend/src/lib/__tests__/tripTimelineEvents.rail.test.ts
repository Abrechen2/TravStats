import { describe, it, expect } from "vitest";
import { buildTimelineEvents } from "../tripTimelineEvents";
import type { Trip } from "../../types";
import type { TripRailJourney } from "../../types/rail";

/**
 * Rail journeys on the trip timeline (spec 2026-09-25-rail-domain, phase 2b):
 * one entry per ride, placed by its departure among the other domains.
 */
const ride = (id: string, departureTime: string): TripRailJourney => ({
  id,
  operator: "DB",
  trainCategory: "ICE",
  trainNumber: "578",
  depStationName: "Frankfurt",
  arrStationName: "Mannheim",
  depTimezone: "Europe/Berlin",
  arrTimezone: "Europe/Berlin",
  departureTime,
  arrivalTime: null,
  distanceKm: null,
  distanceSource: null,
  status: "completed",
  delayMinutes: null,
  price: null,
  currency: "EUR",
  bookingId: null,
});

function trip(overrides: Partial<Trip>): Trip {
  return {
    id: "t1",
    flights: [],
    cruises: [],
    stops: [],
    journalEntries: [],
    ...overrides,
  } as Trip;
}

describe("buildTimelineEvents — rail", () => {
  it("adds one entry per ride, in time order among the flights", () => {
    const events = buildTimelineEvents(
      trip({
        railJourneys: [
          ride("r2", "2025-03-03T08:00:00.000Z"),
          ride("r1", "2025-03-01T08:00:00.000Z"),
        ],
        flights: [
          {
            id: "f1",
            depIata: "FRA",
            arrIata: "LIS",
            departureTime: "2025-03-02T10:00:00.000Z",
            arrivalTime: null,
          } as NonNullable<Trip["flights"]>[number],
        ],
      }),
      [],
      "UTC"
    );
    expect(events.map((e) => e.id)).toEqual(["rail-r1", "flight-f1", "rail-r2"]);
    const first = events[0];
    expect(first.kind).toBe("rail");
    if (first.kind === "rail") expect(first.journey.id).toBe("r1");
  });

  it("adds nothing for a trip without rides — the domain's absence is not an entry", () => {
    expect(buildTimelineEvents(trip({ railJourneys: undefined }), [], "UTC")).toEqual([]);
  });
});
