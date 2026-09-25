import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { RailStats } from "../../../../types/rail";

const STATS: RailStats = {
  journeys: 3,
  distance: {
    totalKm: 1000,
    straightLineKm: 400,
    tracedKm: 550,
    ticketKm: 50,
    unmeasuredJourneys: 1,
  },
  hoursOnBoard: { hours: 7.5, measuredJourneys: 2 },
  countries: ["AT", "DE"],
  operators: [{ label: "DB Fernverkehr", count: 2 }],
  trainCategories: [{ label: "ICE", count: 2 }],
  stations: [{ label: "Berlin Hbf", count: 2 }],
  longest: {
    id: "4b0c5c7e-7e53-4d8c-8d67-0b2b9e1e1a11",
    depStationName: "Wien Hbf",
    arrStationName: "Hamburg Hbf",
    distanceKm: 550,
    distanceSource: "route",
  },
  delays: {
    recordedJourneys: 1,
    buckets: [
      { upToMinutes: 0, count: 0 },
      { upToMinutes: 5, count: 1 },
      { upToMinutes: 15, count: 0 },
      { upToMinutes: 30, count: 0 },
      { upToMinutes: 60, count: 0 },
      { upToMinutes: null, count: 0 },
    ],
  },
  byYear: [{ year: 2025, journeys: 3, km: 1000 }],
};

vi.mock("../../../../lib/api/rail", () => ({
  railApi: { stats: vi.fn(async () => STATS) },
}));

import RailStatsSection from "../RailStatsSection";

const visibility = { isVisible: () => true, toggle: vi.fn(), reset: vi.fn(), hiddenCount: 0 };

describe("RailStatsSection", () => {
  it("labels every kilometre with what it measures", async () => {
    render(
      <MemoryRouter>
        <RailStatsSection
          scope={{ year: null, compareYear: null } as never}
          visibility={visibility}
        />
      </MemoryRouter>
    );
    const split = await screen.findByTestId("rail-km-split");
    // Test i18n renders keys: each source appears under its own label.
    expect(split.textContent).toContain("rail:stats.kmTraced");
    expect(split.textContent).toContain("rail:stats.kmTicket");
    expect(split.textContent).toContain("rail:stats.kmStraight");
    expect(split.textContent).toContain("rail:stats.kmUnmeasured");
  });

  it("links the longest ride to its own page", async () => {
    render(
      <MemoryRouter>
        <RailStatsSection
          scope={{ year: null, compareYear: null } as never}
          visibility={visibility}
        />
      </MemoryRouter>
    );
    const link = await screen.findByRole("link", { name: /Wien Hbf/ });
    expect(link.getAttribute("href")).toBe(`/rail/${STATS.longest!.id}`);
  });
});
