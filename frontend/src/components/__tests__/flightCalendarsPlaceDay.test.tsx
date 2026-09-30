import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FlightCalendar from "../FlightCalendar";
import YearHeatmap from "../YearHeatmap";
import type { Flight } from "../../types";

/**
 * The two flight calendars on the statistics page put a flight on the day it
 * departed AT ITS AIRPORT (ADR 0002, `times.departure.local`) — not on the
 * day the reader's own clock showed at that instant.
 *
 * The fixture is a Haneda departure at 01:00 on 1 January 2026, which is
 * still 31 December 2025 in UTC (16:00Z) and in every zone west of Tokyo.
 * Read on the host's clock it sat in the wrong day, month and year.
 */
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${JSON.stringify(options)}` : key,
    i18n: { language: "de" },
  }),
}));
vi.mock("../AirlineLogo", () => ({ default: () => null }));

const hnd = {
  id: "f1",
  airline: "ANA",
  flightNumber: "NH 217",
  depIata: "HND",
  arrIata: "MUC",
  departureTime: "2025-12-31T16:00:00.000Z",
  arrivalTime: "2026-01-01T04:25:00.000Z",
  depTimezone: "Asia/Tokyo",
  arrTimezone: "Europe/Berlin",
  depTimeSemantics: "UTC",
  times: {
    departure: {
      utc: "2025-12-31T16:00:00.000Z",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      local: "2026-01-01T01:00:00",
      precision: "minute",
    },
    arrival: null,
  },
} as unknown as Flight;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("FlightCalendar — the airport's day", () => {
  it("shows the Haneda departure on 1 January at 01:00, not on 31 December", () => {
    render(<FlightCalendar flights={[hnd]} />);
    // January 2026 is on screen; its 1st is the only day with a flight.
    const withFlight = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("cursor-pointer"));
    expect(withFlight).toHaveLength(1);
    expect(withFlight[0].textContent).toMatch(/^1\b/);
    fireEvent.click(withFlight[0]);
    expect(screen.getByText("Donnerstag, 1. Januar 2026")).toBeTruthy();
    expect(screen.getByText("01:00")).toBeTruthy();
  });
});

describe("YearHeatmap — the airport's year", () => {
  it("counts the Haneda departure in 2026", () => {
    render(<YearHeatmap flights={[hnd]} />);
    const label = screen.getByText('stats:heatmap.flightsInYear|{"year":2026}');
    expect(label.previousElementSibling?.textContent).toBe("1");
  });
});
