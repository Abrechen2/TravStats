import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { RoadtripSummary } from "../../../types/roadtrip";

/**
 * The roadtrip tab set a year against the compare year nowhere — the cruise,
 * lodging, places and rail tabs all draw the comparison strip, and roadtrips
 * showed only the filtered year. It now compares the same counts, from the
 * same rows its tiles fold, and says an empty year is empty for THAT year.
 */

const trip = (id: string, startDate: string, km: number, countries: string[]): RoadtripSummary =>
  ({
    id,
    kind: "roadtrip",
    name: id,
    startDate,
    distanceKm: km,
    drivenKm: km,
    stayNights: 0,
    freeNights: 0,
    nights: 0,
    nightsKnown: true,
    countries,
    vehicle: null,
  }) as unknown as RoadtripSummary;

// The insights (forgejo#260) load beside the list and have their own suite;
// here they stay pending so this test reaches no network.
vi.mock("../../../lib/api/statsInsights", () => ({
  statsInsightsApi: {
    roadtrips: () => new Promise(() => {}),
    tours: () => new Promise(() => {}),
  },
}));
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: {
    list: vi.fn(async () => [
      trip("a", "2025-07-01", 1200, ["NO", "SE"]),
      trip("b", "2025-08-01", 300, ["DE"]),
      trip("c", "2024-05-01", 800, ["FR"]),
    ]),
  },
}));

import RoadtripStatsSection from "../RoadtripStatsSection";

const visibility = { isVisible: () => true, toggle: vi.fn(), reset: vi.fn(), hiddenCount: 0 };

describe("RoadtripStatsSection — year against compare year", () => {
  it("draws the comparison strip with both years' counts", async () => {
    // A router: every tile opens its roadtrips in the evidence panel (forgejo#260).
    render(
      <MemoryRouter>
        <RoadtripStatsSection
          scope={{ year: 2025, compareYear: 2024 } as never}
          visibility={visibility}
        />
      </MemoryRouter>
    );
    const strip = await screen.findByRole("region", { name: "stats:yearFilter.scopeLabel" });
    // 2 roadtrips, 1 500 km, 3 countries in 2025.
    // A distance with its unit on both sides — "Strecke 2.620" read as a bare
    // number (acceptance run, 2026-09-26).
    expect(strip.textContent).toContain("1,500 km");
    expect(strip.textContent).toContain("800 km (2024)");
    expect(strip.textContent).toMatch(/roadtrips:stats\.count\s*2/);
  });

  it("names the year when the chosen year holds no roadtrip", async () => {
    render(
      <RoadtripStatsSection
        scope={{ year: 2023, compareYear: null } as never}
        visibility={visibility}
      />
    );
    expect(await screen.findByText("stats:period.emptyYear")).toBeInTheDocument();
  });
});
