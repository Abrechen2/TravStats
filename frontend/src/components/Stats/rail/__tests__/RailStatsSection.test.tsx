import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { RailStats } from "../../../../types/rail";

const STATS: RailStats = {
  journeys: 3,
  distance: {
    totalKm: 1000,
    straightLineKm: 400,
    tracedKm: 550,
    roadtripKm: 120,
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
    averageMinutes: 4,
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
  rideKinds: { nightTrains: 1, highSpeed: 2, crossBorder: 1, operators: 2 },
};

vi.mock("../../../../lib/api/rail", () => ({
  railApi: { stats: vi.fn(async () => STATS) },
}));

import RailStatsSection from "../RailStatsSection";
import { railApi } from "../../../../lib/api/rail";

const visibility = { isVisible: () => true, toggle: vi.fn(), reset: vi.fn(), hiddenCount: 0 };

describe("RailStatsSection", () => {
  // Acceptance D11 (2026-09-26): the rail tab set a running year against the
  // whole previous one while the overview compared the same span.
  it("compares a running year with the same span of the other, as the overview does", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 26, 12));
    try {
      render(
        <MemoryRouter>
          <RailStatsSection
            scope={{ year: 2026, compareYear: 2025 } as never}
            visibility={visibility}
          />
        </MemoryRouter>
      );
      await waitFor(() => expect(railApi.stats).toHaveBeenCalledWith(2025, "09-26"));
      expect(railApi.stats).toHaveBeenCalledWith(2026, "09-26");
      await screen.findAllByText("rail:stats.journeys");
    } finally {
      vi.useRealTimers();
    }
  });

  it("compares two finished years in full", async () => {
    vi.mocked(railApi.stats).mockClear();
    render(
      <MemoryRouter>
        <RailStatsSection
          scope={{ year: 2023, compareYear: 2022 } as never}
          visibility={visibility}
        />
      </MemoryRouter>
    );
    await waitFor(() => expect(railApi.stats).toHaveBeenCalledWith(2022, null));
    await screen.findAllByText("rail:stats.journeys");
  });

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
    // Review 2026-09-26, finding 7: roadtrip lines are their own source.
    expect(split.textContent).toContain("rail:stats.kmRoadtrip");
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

  it("shows the kinds of ride the rail badges count, each opening the rides behind it", async () => {
    render(
      <MemoryRouter>
        <RailStatsSection
          scope={{ year: null, compareYear: null } as never}
          visibility={visibility}
        />
      </MemoryRouter>
    );
    const kinds = await screen.findByTestId("rail-ride-kinds");
    for (const label of ["nightTrains", "highSpeed", "crossBorder", "operatorsCount"]) {
      expect(kinds.textContent).toContain(`rail:stats.${label}`);
    }
    // Every figure there — and the three headline ones — is an evidence trigger.
    const triggers = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-haspopup"));
    expect(triggers.length).toBe(7);
  });
});
