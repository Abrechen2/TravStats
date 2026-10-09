import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RoadtripSummary } from "../../../types/roadtrip";

/**
 * forgejo#260 — the distance tile sums each started roadtrip's whole route, so
 * on a roadtrip under way it holds stretches not yet driven. The tile now says
 * how many, from the insights' one timeline rule, and a failed insights load
 * says so instead of leaving the blocks silently missing.
 */
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colorOf: () => "#a9c46a" }),
}));
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: {
    list: vi.fn(async () => [
      {
        id: "r1",
        kind: "roadtrip",
        name: "Skandinavien",
        startDate: "2026-07-10",
        distanceKm: 990,
        drivenKm: 850,
        stayNights: 0,
        freeNights: 4,
        nights: 4,
        nightsKnown: true,
        countries: ["DE"],
        vehicle: null,
      } as unknown as RoadtripSummary,
    ]),
  },
}));
const roadtripInsights = vi.fn();
vi.mock("../../../lib/api/statsInsights", () => ({
  statsInsightsApi: { roadtrips: () => roadtripInsights() },
}));

import RoadtripStatsSection from "../RoadtripStatsSection";

const visibility = { isVisible: () => true, toggle: vi.fn(), reset: vi.fn(), hiddenCount: 0 };

describe("RoadtripStatsSection — the stretch still ahead", () => {
  it("says how much of the distance is still to come", async () => {
    roadtripInsights.mockResolvedValueOnce({
      roadtrips: [
        {
          id: "r1",
          name: "Skandinavien",
          year: 2026,
          phase: "current",
          km: { recorded: 540, current: 0, planned: 450, unplaced: 0 },
          kmBySource: {},
          kmByMode: {},
          nights: { recorded: 4, planned: 1 },
          nightsByStyle: { pitch: 4, campsite: 0, lodging: 0 },
          unknownLengthStations: 0,
          countries: { recorded: ["DE"], planned: [] },
          restDays: null,
          tours: { completed: 0, km: 0, ascentM: null },
        },
      ],
      pace: {
        dayStages: 0,
        medianDayKm: null,
        longestDay: null,
        unstagedLegs: 0,
        restDays: 0,
        fullyDatedTrips: 0,
      },
      totals: {},
    });
    render(
      <MemoryRouter>
        <RoadtripStatsSection
          scope={{ year: null, compareYear: null } as never}
          visibility={visibility}
        />
      </MemoryRouter>
    );
    expect(
      await screen.findByText(
        "Davon 450 km noch vor dir – erst wenn sie gefahren sind, zählen sie für Auszeichnungen."
      )
    ).toBeInTheDocument();
  });

  it("says when the insights could not be loaded", async () => {
    roadtripInsights.mockRejectedValueOnce(new Error("offline"));
    render(
      <MemoryRouter>
        <RoadtripStatsSection
          scope={{ year: null, compareYear: null } as never}
          visibility={visibility}
        />
      </MemoryRouter>
    );
    expect(
      await screen.findByText("Die Roadtrip-Auswertungen konnten nicht geladen werden.")
    ).toBeInTheDocument();
  });
});
