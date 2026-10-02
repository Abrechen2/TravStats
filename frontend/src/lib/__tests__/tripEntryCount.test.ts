import { describe, it, expect } from "vitest";
import { tripEntryCounts, tripEntryTotal } from "../tripEntryCount";
import type { Trip } from "../../types";

const all = (): boolean => true;

describe("tripEntryCounts (forgejo#169)", () => {
  it("counts a trip holding only a train ride as one entry", () => {
    const trip = {
      _count: { flights: 0, cruises: 0, lodgingStays: 0, railJourneys: 1 },
    } as unknown as Trip;
    expect(tripEntryTotal(tripEntryCounts(trip, all))).toBe(1);
  });

  it("counts every area the trip page lists", () => {
    const trip = {
      _count: {
        flights: 2,
        cruises: 1,
        lodgingStays: 3,
        railJourneys: 1,
        rentalBookings: 1,
        roadtrips: 1,
        routes: 4,
        photos: 9,
      },
    } as unknown as Trip;
    const counts = tripEntryCounts(trip, all);
    expect(counts).toMatchObject({ rail: 1, rental: 1, roadtrip: 1, poi: 0 });
    // Sections and photos are not entries: 2 + 1 + 3 + 1 + 1 + 1.
    expect(tripEntryTotal(counts)).toBe(9);
  });

  it("leaves out an area the reader cannot see", () => {
    const trip = { _count: { flights: 1, railJourneys: 2 } } as unknown as Trip;
    const counts = tripEntryCounts(trip, (d) => d !== "rail");
    expect(tripEntryTotal(counts)).toBe(1);
  });

  it("falls back to the arrays when no _count came along", () => {
    const trip = { flights: [{}], railJourneys: [{}, {}] } as unknown as Trip;
    expect(tripEntryTotal(tripEntryCounts(trip, all))).toBe(3);
  });
});
