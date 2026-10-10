import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { JSX } from "react";
import type { PlaceInsights } from "../../../../types/statsInsights";

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const places = vi.fn();
vi.mock("../../../../lib/api/statsInsights", () => ({
  statsInsightsApi: { places: (...a: unknown[]) => places(...a) },
}));

import PoiInsightsSection from "../PoiInsightsSection";

const EMPTY: PlaceInsights = {
  discoveries: { byYear: [], placesWithoutDatedVisit: 2, undatedVisits: 0 },
  revisits: { longestGap: null, longestGapYears: 0, returning: [] },
  diversity: { trips: [], cities: [], byYear: [], tripCategoriesMax: 0, visitsWithoutTrip: 0 },
  documentation: {
    visits: 0,
    withPhoto: 0,
    withNote: 0,
    withRating: 0,
    withNoteAndPhoto: 0,
    byYear: [],
  },
  jump: { longest: null, uncertainPairs: 0, undatedVisits: 0 },
  plannedVisits: 0,
  totals: {},
};

const FULL: PlaceInsights = {
  ...EMPTY,
  discoveries: {
    byYear: [
      { year: 2018, discoveries: 3, revisits: 0, unordered: 0 },
      { year: 2024, discoveries: 1, revisits: 2, unordered: 1 },
    ],
    placesWithoutDatedVisit: 0,
    undatedVisits: 1,
  },
  revisits: {
    longestGap: {
      placeId: "p1",
      name: "Trevi-Brunnen",
      days: 2200,
      fromVisitId: "a",
      toVisitId: "b",
      from: "2018-05-01",
      to: "2024-05-10",
    },
    longestGapYears: 6,
    returning: [{ placeId: "p1", name: "Trevi-Brunnen", years: [2018, 2024], visits: 2 }],
  },
  diversity: {
    trips: [{ tripId: "t1", tripName: "Rom", year: 2018, categories: ["landmark", "museum"] }],
    cities: [{ city: "Rom", country: "IT", categories: ["landmark", "museum"] }],
    byYear: [{ year: 2018, categories: ["landmark", "museum"] }],
    tripCategoriesMax: 2,
    visitsWithoutTrip: 3,
  },
  documentation: {
    visits: 4,
    withPhoto: 2,
    withNote: 1,
    withRating: 0,
    withNoteAndPhoto: 1,
    byYear: [{ year: 2024, visits: 3, withPhoto: 1, withNote: 0, withRating: 0 }],
  },
  jump: {
    longest: {
      km: 1182.4,
      from: { visitId: "a", placeId: "p1", name: "Trevi-Brunnen", day: "2018-05-01" },
      to: { visitId: "c", placeId: "p2", name: "Brandenburger Tor", day: "2018-05-03" },
    },
    uncertainPairs: 2,
    undatedVisits: 1,
  },
  totals: {
    placeDiscoveryVisits: { allTime: 4, byYear: { "2018": 3, "2024": 1 } },
    placeRevisitVisits: { allTime: 2, byYear: { "2024": 2 } },
    placeVisitsWithPhoto: { allTime: 2, byYear: { "2024": 1 } },
    placeVisitsWithNote: { allTime: 1, byYear: {} },
  },
};

function Url(): JSX.Element {
  return <span data-testid="url">{useLocation().search}</span>;
}

function renderAt(year: number | null): void {
  render(
    <MemoryRouter>
      <PoiInsightsSection year={year} accent="#e7e3dc" />
      <Url />
    </MemoryRouter>
  );
}

describe("PoiInsightsSection (forgejo#259)", () => {
  beforeEach(() => places.mockReset());

  it("separates first visits from returns and opens the panel for each", async () => {
    places.mockResolvedValueOnce(FULL);
    renderAt(2024);
    const tile = await screen.findByTestId("insight-discoveries");
    expect(tile.textContent).toContain("Erstbesuche · 2 Wiederbesuche");
    fireEvent.click(within(tile).getByRole("button", { name: "Wiederbesuche" }));
    expect(screen.getByTestId("url").textContent).toContain("evidence=metric%3AplaceRevisitVisits");
    // The first visits are the tile's own number, and open their own list.
    fireEvent.click(within(tile).getByRole("button", { name: /Entdeckungen/ }));
    expect(screen.getByTestId("url").textContent).toContain(
      "evidence=metric%3AplaceDiscoveryVisits"
    );
  });

  it("says why some visits are in neither column", async () => {
    places.mockResolvedValueOnce(FULL);
    renderAt(2024);
    const help = await screen.findByTestId("insight-discoveries-help");
    expect(help.textContent).toContain(
      "1 datierte Besuche gehören zu Orten mit einem undatierten Besuch"
    );
  });

  it("calls the largest jump a straight line and names both visits", async () => {
    places.mockResolvedValueOnce(FULL);
    renderAt(null);
    const jump = await screen.findByTestId("insight-jump");
    expect(jump.textContent).toContain("km Luftlinie");
    expect(within(jump).getByTestId("insight-jump-help").textContent).toContain(
      "nicht die zurückgelegte Strecke"
    );
    const links = within(jump).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/places/p1", "/places/p2"]);
  });

  it("shows photo, note and rating as three separate shares, never a score", async () => {
    places.mockResolvedValueOnce(FULL);
    renderAt(null);
    const doc = await screen.findByTestId("insight-documentation");
    expect(doc.textContent).toContain("50 % mit Foto");
    expect(doc.textContent).toContain("25 % mit Notiz · 0 % mit Bewertung");
    expect(within(doc).getByTestId("insight-documentation-help").textContent).toContain(
      "nie eine verlangt"
    );
  });

  it("lets every figure open the entries behind it (forgejo#259)", async () => {
    places.mockResolvedValueOnce(FULL);
    renderAt(null);
    await screen.findByTestId("insight-jump");
    const opened = (testId: string): string => {
      fireEvent.click(within(screen.getByTestId(testId)).getAllByRole("button", { name: /./ })[0]);
      return screen.getByTestId("url").textContent ?? "";
    };
    expect(opened("insight-returning")).toContain("placeReturningPlaceCount");
    expect(opened("insight-variety")).toContain("placeVarietyTripCategories");
    expect(opened("insight-documentation")).toContain("placeVisitsWithPhoto");
    expect(opened("insight-jump")).toContain("placeLongestJumpVisits");
  });

  it("names the existing data that would fill an empty figure", async () => {
    places.mockResolvedValueOnce(EMPTY);
    renderAt(null);
    expect((await screen.findByTestId("insight-variety-empty")).textContent).toContain(
      "einer Reise zugeordnet"
    );
    expect(screen.getByTestId("insight-jump-empty").textContent).toContain("sicherer Reihenfolge");
  });
});
