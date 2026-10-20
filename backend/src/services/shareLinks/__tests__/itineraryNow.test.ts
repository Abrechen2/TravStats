import { describe, expect, it } from "@jest/globals";

import type { ItineraryItem } from "../../../schemas/shareLinkItinerary";
import { serializeDay, serializeTime } from "../../../shared/time/wire";
import { itineraryAutoExpiry, nowMarker, sortItinerary, spanOfItem } from "../itineraryNow";

/**
 * The "now" marker and the link's own end (forgejo#302) — pure, on instants
 * and on each day's bounds at its place, never on the host's zone (the suite
 * also runs under the odd-zone CI jobs).
 */

const NY = "America/New_York";
const at = (iso: string, precision: "minute" | "day" | "month" = "minute") =>
  serializeTime(new Date(iso), NY, precision);

const visit = (iso: string, precision: "minute" | "day" | "month" = "minute"): ItineraryItem => ({
  kind: "visit",
  name: "Somewhere",
  city: null,
  at: at(iso, precision),
});

const ride = (dep: string, arr: string): ItineraryItem => ({
  kind: "rail",
  operator: null,
  service: null,
  from: "A",
  to: "B",
  departure: at(dep),
  arrival: at(arr),
});

const stay = (checkIn: string, checkOut: string): ItineraryItem => ({
  kind: "stay",
  name: "Hotel",
  address: null,
  city: null,
  country: null,
  checkIn: serializeDay(checkIn, NY),
  checkOut: serializeDay(checkOut, NY),
  checkInAt: null,
  checkOutAt: null,
});

describe("itinerary spans", () => {
  it("covers a day-only stay from the first local midnight to the end of the last day", () => {
    expect(spanOfItem(stay("2030-06-01", "2030-06-03"))).toEqual({
      start: Date.parse("2030-06-01T04:00:00Z"),
      end: Date.parse("2030-06-04T04:00:00Z"),
    });
  });

  it("gives a value known only to the month no span — no invented midnight", () => {
    expect(spanOfItem(visit("2030-06-01T04:00:00Z", "month"))).toBeNull();
  });

  it("sorts by the instant an entry begins and puts an undated one last", () => {
    const undated = visit("2030-06-01T04:00:00Z", "month");
    const late = ride("2030-06-03T10:00:00Z", "2030-06-03T12:00:00Z");
    const early = ride("2030-06-02T10:00:00Z", "2030-06-02T12:00:00Z");
    expect(sortItinerary([undated, late, early])).toEqual([early, late, undated]);
  });
});

describe("nowMarker", () => {
  const items = sortItinerary([
    stay("2030-06-01", "2030-06-05"),
    ride("2030-06-02T14:00:00Z", "2030-06-02T18:00:00Z"),
    visit("2030-06-07T15:00:00Z"),
  ]);

  it("names the next entry before anything has begun", () => {
    expect(nowMarker(items, new Date("2030-05-30T00:00:00Z"))).toEqual({
      index: 0,
      state: "next",
    });
  });

  it("prefers the entry that began last when two are in progress", () => {
    expect(nowMarker(items, new Date("2030-06-02T15:00:00Z"))).toEqual({
      index: 1,
      state: "inProgress",
    });
    expect(nowMarker(items, new Date("2030-06-02T19:00:00Z"))).toEqual({
      index: 0,
      state: "inProgress",
    });
  });

  it("names the next entry between two, and nothing once all are over", () => {
    expect(nowMarker(items, new Date("2030-06-06T12:00:00Z"))).toEqual({
      index: 2,
      state: "next",
    });
    expect(nowMarker(items, new Date("2030-06-08T00:00:00Z"))).toBeNull();
  });
});

describe("itineraryAutoExpiry", () => {
  it("ends 24 hours after the trip's last local day", () => {
    expect(itineraryAutoExpiry(serializeDay("2030-06-08", NY))?.toISOString()).toBe(
      "2030-06-10T04:00:00.000Z"
    );
  });

  it("reads a last day with no zone where that day ends last on Earth", () => {
    expect(itineraryAutoExpiry(serializeDay("2030-06-08", null))?.toISOString()).toBe(
      "2030-06-10T12:00:00.000Z"
    );
  });

  it("names no end without a last day, or with only its month", () => {
    expect(itineraryAutoExpiry(null)).toBeNull();
    expect(itineraryAutoExpiry(serializeDay("2030-06-01", NY, "month"))).toBeNull();
  });
});
