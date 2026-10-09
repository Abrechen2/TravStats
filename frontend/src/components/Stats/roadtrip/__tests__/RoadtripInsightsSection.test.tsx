import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { JSX } from "react";
import type { RoadtripInsights, RoadtripInsightRow } from "../../../../types/statsInsights";

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

import RoadtripInsightsSection from "../RoadtripInsightsSection";

const row = (over: Partial<RoadtripInsightRow>): RoadtripInsightRow => ({
  id: "r1",
  name: "Skandinavien",
  year: 2026,
  phase: "current",
  km: { recorded: 540, current: 0, planned: 450, unplaced: 0 },
  kmBySource: { routed: 400, straight: 140 },
  kmByMode: { road: 400, ferry: 140 },
  nights: { recorded: 4, planned: 1 },
  nightsByStyle: { pitch: 3, campsite: 1, lodging: 0 },
  unknownLengthStations: 1,
  countries: { recorded: ["DE", "DK", "NO"], planned: [] },
  restDays: null,
  tours: { completed: 2, km: 20, ascentM: 800 },
  ...over,
});

const DATA: RoadtripInsights = {
  roadtrips: [
    row({}),
    row({
      id: "r0",
      name: "Alpen",
      year: 2024,
      km: { recorded: 900, current: 0, planned: 0, unplaced: 0 },
    }),
  ],
  pace: {
    dayStages: 3,
    medianDayKm: 240,
    longestDay: { roadtripId: "r1", name: "Skandinavien", day: "2026-07-11", km: 400 },
    unstagedLegs: 1,
    restDays: 2,
    fullyDatedTrips: 1,
  },
  totals: {
    roadtripRecordedKm: { allTime: 1440, byYear: { "2024": 900, "2026": 540 } },
    roadtripDrivenKm: { allTime: 400, byYear: { "2026": 400 } },
    roadtripFerryKm: { allTime: 140, byYear: { "2026": 140 } },
    roadtripRecordedNights: { allTime: 4, byYear: { "2026": 4 } },
  },
};

function Url(): JSX.Element {
  return <span data-testid="url">{useLocation().search}</span>;
}

function renderAt(year: number | null, data: RoadtripInsights = DATA): void {
  render(
    <MemoryRouter>
      <RoadtripInsightsSection data={data} year={year} accent="#a9c46a" />
      <Url />
    </MemoryRouter>
  );
}

describe("RoadtripInsightsSection (forgejo#260)", () => {
  it("keeps what was driven apart from what is still planned", () => {
    renderAt(2026);
    const tile = screen.getByTestId("insight-progress");
    expect(tile.textContent).toContain("540 km");
    expect(tile.textContent).toContain("noch geplant 450 km");
    expect(within(tile).getByTestId("insight-progress-sources").textContent).toContain(
      "Route 400 km"
    );
  });

  it("never reports ferry kilometres as driven, and opens each on its own", () => {
    renderAt(2026);
    const modes = screen.getByTestId("insight-modes");
    expect(modes.textContent).toContain("400 km / 140 km");
    fireEvent.click(within(modes).getByRole("button", { name: "Fährkilometer" }));
    expect(screen.getByTestId("url").textContent).toContain("evidence=metric%3AroadtripFerryKm");
    expect(within(modes).getByTestId("insight-modes-help").textContent).toContain(
      "nie selbst gefahrene Kilometer"
    );
  });

  it("shows where the nights were slept and names stations of unknown length", () => {
    renderAt(2026);
    const nights = screen.getByTestId("insight-night-style");
    expect(nights.textContent).toContain("Stellplatz / frei");
    expect(nights.textContent).toContain("1 Übernachtungsstation ohne bekannte Länge");
  });

  it("puts the tours beside the driving and links the roadtrip", () => {
    renderAt(null);
    const tours = screen.getByTestId("insight-tours-along");
    expect(tours.textContent).toContain("2 Touren");
    const link = within(tours).getByRole("link", { name: "Skandinavien" });
    expect(link.getAttribute("href")).toBe("/roadtrips/r1");
  });

  it("names what would fill an empty figure", () => {
    renderAt(2025);
    expect(screen.getByTestId("insight-progress-empty").textContent).toContain("ersten Roadtrip");
  });
});
