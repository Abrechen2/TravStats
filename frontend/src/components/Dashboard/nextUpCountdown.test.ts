import { describe, expect, it } from "vitest";
import { entryCountdown } from "./nextUpCountdown";
import type { UpcomingEntry } from "../../lib/api/upcoming";
import { timeValueAtZone } from "../../shared/time/legacy";

const entry = (startsAt: string, zone: string, precision: "day" | "minute"): UpcomingEntry => ({
  domain: "bus",
  id: "bus",
  detailId: "bus",
  startsAt,
  startsAtPrecision: precision,
  tripId: null,
  tripName: null,
  primary: "Kobus · Seoul",
  secondary: "Sokcho",
  times: {
    departure: timeValueAtZone(startsAt, zone, precision),
    arrival: null,
    actualDeparture: null,
    actualArrival: null,
  },
});

describe("open bus tickets on the terminal calendar", () => {
  it("counts calendar days across the autumn clock change", () => {
    expect(
      entryCountdown(
        entry("2026-10-25T23:00:00Z", "Europe/Berlin", "day"),
        Date.parse("2026-10-24T21:00:00Z")
      )
    ).toEqual({ kind: "days", count: 2 });
  });
  it("counts tomorrow as a day even when terminal midnight is only an hour away", () => {
    expect(
      entryCountdown(
        entry("2026-10-12T15:00:00Z", "Asia/Seoul", "day"),
        Date.parse("2026-10-12T14:00:00Z")
      )
    ).toEqual({ kind: "days", count: 1 });
  });
  it("still says today after terminal midnight, regardless of the browser day", () => {
    expect(
      entryCountdown(
        entry("2026-10-12T15:00:00Z", "Asia/Seoul", "day"),
        Date.parse("2026-10-12T16:00:00Z")
      )
    ).toEqual({ kind: "today" });
  });
  it("keeps the hour countdown for a timed bus", () => {
    expect(
      entryCountdown(
        entry("2026-10-13T00:00:00Z", "Asia/Seoul", "minute"),
        Date.parse("2026-10-12T22:00:00Z")
      )
    ).toEqual({ kind: "hours", count: 2 });
  });
});
