import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Cruise, CruiseStop, Port } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import CruiseItinerary from "../CruiseItinerary";

const miami: Port = {
  id: 1,
  name: "Miami",
  city: "Miami",
  country: "United States",
  unlocode: "USMIA",
  lat: 25.77,
  lon: -80.19,
  timezone: "America/New_York",
  region: null,
  isUserAdded: false,
};

const stop = (over: Partial<CruiseStop>): CruiseStop => ({
  id: `s${over.dayNumber}`,
  cruiseId: "c",
  portId: null,
  port: null,
  dayNumber: 1,
  date: null,
  isAtSea: false,
  arrivalTime: null,
  departureTime: null,
  excursionNote: null,
  unresolvedPortName: null,
  ...over,
});

const cruise = (stops: CruiseStop[]): Cruise =>
  ({ stops, departurePort: null, arrivalPort: null, startDate: null, endDate: null }) as Cruise;

describe("CruiseItinerary", () => {
  it("shows stop times as entered, not shifted into the port's zone", () => {
    render(
      <CruiseItinerary
        cruise={cruise([
          stop({
            dayNumber: 1,
            portId: 1,
            port: miami,
            arrivalTime: "2026-12-07T07:00:00.000Z",
            departureTime: "2026-12-07T17:30:00.000Z",
          }),
        ])}
      />
    );
    // The stops editor stores wall-clock values; in America/New_York the
    // same strings would read 02:00 · 12:30.
    expect(screen.getByText("07:00 · 17:30")).toBeTruthy();
    expect(screen.getByText("United States")).toBeTruthy();
  });

  it("draws a sea day without a port line or times", () => {
    render(<CruiseItinerary cruise={cruise([stop({ dayNumber: 2, isAtSea: true })])} />);
    const item = screen.getByText("stops.at_sea").closest("li");
    expect(item?.textContent).not.toMatch(/\d\d:\d\d/);
  });
});
