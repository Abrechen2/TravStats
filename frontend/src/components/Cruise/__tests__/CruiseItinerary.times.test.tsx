import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Cruise, CruiseStop } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import CruiseItinerary from "../CruiseItinerary";

/**
 * A port call shows the server's `times` (ADR 0002, phase 4): the port's day
 * and clock as `local`. The phase-2 columns carry the REAL instants — 12:00Z
 * is 08:00 in Miami in December — and reading those instead of `local` in any
 * zone but the port's printed the wrong hour.
 */
const stop: CruiseStop = {
  id: "s1",
  cruiseId: "c",
  portId: null,
  port: null,
  dayNumber: 1,
  date: null,
  isAtSea: false,
  arrivalTime: null,
  departureTime: null,
  excursionNote: null,
  unresolvedPortName: "Miami",
  arrivalUtc: "2026-12-07T12:00:00.000Z",
  departureUtc: "2026-12-07T22:30:00.000Z",
  stopZone: "America/New_York",
  times: {
    date: { date: "2026-12-07", zone: "America/New_York", precision: "day" },
    arrival: {
      utc: "2026-12-07T12:00:00.000Z",
      zone: "America/New_York",
      offset: "-05:00",
      local: "2026-12-07T07:00:00",
      precision: "minute",
    },
    departure: {
      utc: "2026-12-07T22:30:00.000Z",
      zone: "America/New_York",
      offset: "-05:00",
      local: "2026-12-07T17:30:00",
      precision: "minute",
    },
  },
};

const cruise = {
  stops: [stop],
  departurePort: null,
  arrivalPort: null,
  startDate: null,
  endDate: null,
} as unknown as Cruise;

describe("CruiseItinerary — times from the server", () => {
  it("shows the port's clock and day", () => {
    render(<CruiseItinerary cruise={cruise} />);
    expect(screen.getByText("07:00 · 17:30")).toBeTruthy();
    expect(screen.getByText("07.12.")).toBeTruthy();
  });
});
