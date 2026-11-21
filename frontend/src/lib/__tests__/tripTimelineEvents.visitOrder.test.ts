import { describe, it, expect } from "vitest";
import { buildTimelineEvents } from "../tripTimelineEvents";
import { findTimelineInconsistencies } from "../tripTimelinePlausibility";
import type { Trip } from "../../types";
import type { Place, PlaceVisit } from "../../types/place";
import type { TimeValue } from "../../shared/time";

/**
 * forgejo#432: a place visit carries a date only, so on the day of a timed
 * flight it sorted at the day's start — a visit in Lisbon showed ABOVE the
 * flight that took the traveller there. The order now reads where the visit
 * is: near the arrival it follows the flight, near the departure point it
 * precedes it, and a visit with a time of its own is ordered by that time.
 */
type TripFlight = NonNullable<Trip["flights"]>[number];

const tv = (local: string, zone: string, offset: string, precision = "minute"): TimeValue => ({
  utc: new Date(`${local}${offset}`).toISOString(),
  zone,
  offset,
  local,
  precision: precision as TimeValue["precision"],
});

// Berlin 08:00 -> Lisbon 10:30 local (Lisbon is UTC+1 in winter)
const dep = tv("2026-01-10T08:00:00", "Europe/Berlin", "+01:00");
const arr = tv("2026-01-10T10:30:00", "Europe/Lisbon", "+00:00");
const flight = {
  id: "f1",
  depIata: "BER",
  arrIata: "LIS",
  depLat: 52.36,
  depLon: 13.5,
  arrLat: 38.77,
  arrLon: -9.13,
  times: { departure: dep, arrival: arr },
} as unknown as TripFlight;
const trip = { id: "t1", flights: [flight], cruises: [], stops: [] } as unknown as Trip;

const place = (id: string, lat: number, lon: number) =>
  ({ id, name: id, lat, lon }) as unknown as Place;
const visit = (id: string, visitedAt: TimeValue): PlaceVisit =>
  ({
    id,
    placeId: id,
    visitedAt: visitedAt.local,
    times: { visitedAt },
    orderIdx: 0,
  }) as unknown as PlaceVisit;
const dayOnly = (zone: string) => tv("2026-01-10T00:00:00", zone, "+00:00", "day");

const ids = (visits: Array<{ place: Place; visit: PlaceVisit }>) =>
  buildTimelineEvents(trip, visits).map((e) => e.id);

describe("place visit order against a same-day flight (forgejo#432)", () => {
  it("puts a time-less visit at the destination AFTER the flight", () => {
    const order = ids([
      { place: place("belem", 38.69, -9.2), visit: visit("v1", dayOnly("Europe/Lisbon")) },
    ]);
    expect(order).toEqual(["flight-f1", "place-visit-v1"]);
  });

  it("puts a time-less visit at home BEFORE the departure", () => {
    const order = ids([
      { place: place("cafe", 52.52, 13.4), visit: visit("v1", dayOnly("Europe/Berlin")) },
    ]);
    expect(order).toEqual(["place-visit-v1", "flight-f1"]);
  });

  it("puts a time-less visit anywhere after the arrival when no departure follows it there", () => {
    const order = ids([
      { place: place("far", 40.0, 0.0), visit: visit("v1", dayOnly("Europe/Lisbon")) },
    ]);
    expect(order).toEqual(["flight-f1", "place-visit-v1"]);
  });

  it("orders a visit that has a time by that time", () => {
    const early = tv("2026-01-10T06:30:00", "Europe/Berlin", "+01:00");
    const late = tv("2026-01-10T15:00:00", "Europe/Lisbon", "+00:00");
    const order = ids([
      { place: place("belem", 38.69, -9.2), visit: visit("late", late) },
      { place: place("cafe", 52.52, 13.4), visit: visit("early", early) },
    ]);
    expect(order).toEqual(["place-visit-early", "flight-f1", "place-visit-late"]);
  });

  it("warns about a timed visit while the traveller is in the air", () => {
    const inAir = tv("2026-01-10T09:00:00", "Europe/Berlin", "+01:00");
    const events = buildTimelineEvents(trip, [
      { place: place("belem", 38.69, -9.2), visit: visit("v1", inAir) },
    ]);
    const codes = findTimelineInconsistencies(events).map((f) => `${f.code}:${f.eventId}`);
    expect(codes).toContain("visitDuringLeg:place-visit-v1");
  });

  it("does not warn about a visit before takeoff or after landing", () => {
    const before = tv("2026-01-10T06:00:00", "Europe/Berlin", "+01:00");
    const after = tv("2026-01-10T12:00:00", "Europe/Lisbon", "+00:00");
    const events = buildTimelineEvents(trip, [
      { place: place("a", 52.52, 13.4), visit: visit("a", before) },
      { place: place("b", 38.69, -9.2), visit: visit("b", after) },
    ]);
    expect(findTimelineInconsistencies(events)).toEqual([]);
  });
});
