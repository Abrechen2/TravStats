import { describe, expect, it } from "vitest";
import { buildTimelineEvents } from "../../../lib/tripTimelineEvents";
import { adaptFerry } from "../../../lib/stats/domain-stats/ferryStatsAdapter";
import type { Trip } from "../../../types";
import type { FerryJourney } from "../../../types/ferry";
const ride = {
  id: "crossing",
  departureTime: "2026-10-07T20:00:00Z",
  arrivalTime: "2026-10-08T05:00:00Z",
  depTimezone: "Europe/Rome",
  arrTimezone: "Europe/Zagreb",
  depCountry: "IT",
  arrCountry: "HR",
  depStationName: "Bari",
  arrStationName: "Dubrovnik",
  status: "completed",
  distanceKm: 200,
  distanceSource: "user",
  operator: "Ferry line",
} as FerryJourney;
describe("Ferry timeline and counting", () => {
  it("places the crossing on the departure port's local clock", () => {
    const trip = { id: "trip", ferryJourneys: [ride] } as unknown as Trip;
    const event = buildTimelineEvents(trip, []).find((e) => e.kind === "ferry");
    expect(event?.when.local?.slice(0, 16)).toBe("2026-10-07T22:00");
    expect(event?.id).toBe("ferry-crossing");
  });
  it("does not count a cancelled crossing as a travelled journey", () => {
    expect(adaptFerry({ journeys: [{ ...ride, status: "cancelled" }] })).toEqual({
      domain: "ferry",
      hasData: false,
    });
    expect(adaptFerry({ journeys: [ride] }).hasData).toBe(true);
  });
});
