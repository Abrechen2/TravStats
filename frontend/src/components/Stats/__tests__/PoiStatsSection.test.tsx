import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import type { Place } from "../../../types/place";

const listPlacesMock = vi.fn();
const listPlaceListsMock = vi.fn();
const listCuratedMock = vi.fn();

vi.mock("../../../lib/api/places", () => ({
  listPlaces: (...a: unknown[]) => listPlacesMock(...a),
}));
vi.mock("../../../lib/api/placeLists", () => ({
  listPlaceLists: (...a: unknown[]) => listPlaceListsMock(...a),
  listCuratedChecklists: (...a: unknown[]) => listCuratedMock(...a),
}));

import PoiStatsSection from "../PoiStatsSection";

/**
 * The tab existed with nothing behind it. What this pins is not the layout but
 * the three things the section could get wrong in a way nobody would notice:
 *
 *  - counting a wishlist entry as somewhere you have been,
 *  - reporting a visit total while quietly dropping the undated ones,
 *  - showing zeros after a failed load, which reads as "you have never been
 *    anywhere" rather than "I could not ask".
 */
const place = (over: Partial<Place> & { id: string; name: string }): Place =>
  ({
    category: "restaurant",
    lat: 41.9,
    lon: 12.48,
    city: "Rom",
    country: "Italien",
    isoCountryCode: "IT",
    visited: true,
    visits: [],
    ...over,
  }) as unknown as Place;

const visit = (visitedAt: string | null) => ({ id: `v-${visitedAt ?? "undated"}`, visitedAt });

describe("PoiStatsSection", () => {
  beforeEach(() => {
    listPlacesMock.mockReset();
    listPlaceListsMock.mockReset().mockResolvedValue([]);
    listCuratedMock.mockReset().mockResolvedValue([]);
  });

  it("counts places you have been to, not ones you mean to go to", async () => {
    listPlacesMock.mockResolvedValue([
      place({ id: "p1", name: "Kolosseum", visits: [visit("2023-04-01")] as never }),
      place({ id: "p2", name: "Sagrada Família", visited: false, visits: [] as never }),
    ]);

    render(<PoiStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("places:stats.visitedPlaces")).toBeInTheDocument();
    });
    const card = screen.getByText("places:stats.visitedPlaces").closest("div")?.parentElement;
    expect(card?.textContent).toContain("1");
    // And the wishlist entry is reported as such rather than vanishing.
    expect(screen.getByText(/places:stats.visitedPlacesDesc/)).toBeInTheDocument();
  });

  it("counts an undated visit and says it has no date", async () => {
    listPlacesMock.mockResolvedValue([
      place({
        id: "p1",
        name: "McDonald's Trevi",
        visits: [visit("2023-04-01"), visit(null)] as never,
      }),
    ]);

    render(<PoiStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("places:stats.visits")).toBeInTheDocument();
    });
    // Two visits, one of which cannot be placed on a day. Dropping it would be
    // a quieter wrong answer than counting it without saying so.
    const card = screen.getByText("places:stats.visits").closest("div")?.parentElement;
    expect(card?.textContent).toContain("2");
    expect(screen.getByText(/places:stats.visitsDesc/)).toBeInTheDocument();
  });

  it("says it could not load rather than showing zeros", async () => {
    listPlacesMock.mockRejectedValue(new Error("network"));

    render(<PoiStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("places:list.loadError")).toBeInTheDocument();
    });
    expect(screen.queryByText("places:stats.visitedPlaces")).not.toBeInTheDocument();
  });

  it("invites a first visit when there is nothing yet", async () => {
    listPlacesMock.mockResolvedValue([]);

    render(<PoiStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("places:stats.empty")).toBeInTheDocument();
    });
  });
});
