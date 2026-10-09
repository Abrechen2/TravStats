import { describe, it, expect } from "@jest/globals";

import { foldTransfers, transfersByYear } from "../transfers";
import { at, row } from "./fixtures";

describe("transfer times (forgejo#256)", () => {
  it("measures only the gaps between flights of ONE booking", () => {
    const { transfers, coverage } = foldTransfers([
      row("MUC", "FRA", "2024-03-02T06:00", "2024-03-02T07:00", { bookingId: "b1", id: "a" }),
      row("FRA", "JFK", "2024-03-02T09:15", "2024-03-02T18:00", { bookingId: "b1", id: "b" }),
      // Close in time, but unlinked: never a "connection".
      row("JFK", "BOS", "2024-03-02T19:00", "2024-03-02T20:00", { id: "c" }),
    ]);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      minutes: 135,
      airport: "FRA",
      airportChange: null,
      day: "2024-03-02",
      arrivingFlightId: "a",
      departingFlightId: "b",
    });
    expect(coverage).toMatchObject({ bookings: 1, gaps: 1, measured: 1 });
  });

  it("measures nothing for a day-only end, and says so instead of counting 0", () => {
    const { transfers, coverage } = foldTransfers([
      row("MUC", "FRA", "2024-03-02T06:00", null, {
        bookingId: "b1",
        arrival: at("2024-03-02T00:00", "day"),
      }),
      row("FRA", "JFK", "2024-03-02T09:15", "2024-03-02T18:00", { bookingId: "b1" }),
    ]);
    expect(transfers).toEqual([]);
    expect(coverage).toMatchObject({ gaps: 1, measured: 0, unknownTime: 1 });
  });

  it("leaves a historical segment's placeholder clock out, counted as not flown", () => {
    const { transfers, coverage } = foldTransfers([
      row("MUC", "FRA", "2019-03-02T12:00", "2019-03-02T13:00", {
        bookingId: "b1",
        status: "historical",
      }),
      row("FRA", "JFK", "2019-03-02T14:00", "2019-03-02T20:00", { bookingId: "b1" }),
    ]);
    expect(transfers).toEqual([]);
    expect(coverage.notFlown).toBe(1);
  });

  it("does not read the return of a round trip as a connection", () => {
    const { transfers, coverage } = foldTransfers([
      row("MUC", "FRA", "2024-03-02T06:00", "2024-03-02T07:00", { bookingId: "b1" }),
      row("FRA", "MUC", "2024-03-02T17:00", "2024-03-02T18:00", { bookingId: "b1" }),
    ]);
    expect(transfers).toEqual([]);
    expect(coverage.separate).toBe(1);
  });

  it("files a year's waits with their median and both extremes", () => {
    const { transfers } = foldTransfers([
      row("MUC", "FRA", "2024-03-02T06:00", "2024-03-02T07:00", { bookingId: "b1" }),
      row("FRA", "JFK", "2024-03-02T08:00", "2024-03-02T16:00", { bookingId: "b1" }),
      row("MUC", "LHR", "2024-05-02T06:00", "2024-05-02T07:00", { bookingId: "b2" }),
      row("LHR", "JFK", "2024-05-02T11:00", "2024-05-02T19:00", { bookingId: "b2" }),
      row("MUC", "CDG", "2024-06-02T06:00", "2024-06-02T07:00", { bookingId: "b3" }),
      row("CDG", "JFK", "2024-06-02T09:30", "2024-06-02T17:00", { bookingId: "b3" }),
    ]);
    const [year] = transfersByYear(transfers);
    expect(year).toMatchObject({ year: 2024, count: 3, totalMinutes: 60 + 240 + 150 });
    expect(year.medianMinutes).toBe(150);
    expect(year.shortest.minutes).toBe(60);
    expect(year.longest.minutes).toBe(240);
  });
});
