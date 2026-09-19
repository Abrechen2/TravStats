import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "@testing-library/react";
import { EVIDENCE_MEASURES } from "../../../shared/evidenceMeasures";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

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
import { ALL_VISIBLE, hiding } from "./sectionVisibilityStub";

const LIFETIME = { year: null, compareYear: null };

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

/**
 * Which tiles open the evidence panel, and under which key — read from the URL
 * the tile itself writes, because `?evidence=metric:<key>` is the whole
 * contract between a tile and the panel and a tile wired to the wrong key
 * looks identical to a correct one until it is clicked.
 *
 * `placeCitiesCount` and `placeWishlistCount` used to be absent: both render
 * inside another card's DESCRIPTION, and a card opens one panel. The owner
 * ruled on 2026-09-19 that the NUMBER inside a description becomes its own
 * inline trigger while the rest of the sentence stays text, so both are wired
 * now. The wishlist one only in the lifetime view — a year holds no wishlist,
 * so that card draws no description at all under a year.
 */
/** `MemoryRouter` never touches `window.location`, so the search string has to be read from inside it. */
function LocationProbe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

describe("PoiStatsSection evidence wiring", () => {
  beforeEach(() => {
    listPlacesMock.mockReset();
    listPlaceListsMock.mockReset().mockResolvedValue([{ id: "l1", name: "Maccis" }]);
    listCuratedMock.mockReset().mockResolvedValue([]);
  });

  it("wires the four served tiles of the lifetime view, and the two numbers inside their sentences", async () => {
    listPlacesMock.mockResolvedValue([
      place({ id: "p1", name: "Kolosseum", visits: [visit("2023-04-01")] as never }),
    ]);
    let search = "";
    render(
      <MemoryRouter>
        <PoiStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
        <LocationProbe
          onChange={(next) => {
            search = next;
          }}
        />
      </MemoryRouter>
    );
    await screen.findByText("places:stats.visitedPlaces");

    const keys: string[] = [];
    for (const trigger of screen.getAllByRole("button")) {
      await act(async () => {
        trigger.click();
      });
      const raw = new URLSearchParams(search).get("evidence") ?? "";
      keys.push(raw.slice(raw.indexOf(":") + 1));
    }
    expect(keys.sort()).toEqual(
      [
        "placeCountriesCount",
        "placeListCount",
        "placeVisitCount",
        "placesVisitedCount",
        // The two figures that live inside another card's sentence.
        "placeCitiesCount",
        "placeWishlistCount",
      ].sort()
    );
    expect(keys.every((key) => EVIDENCE_MEASURES[key]?.servedIn === 1)).toBe(true);
  });
});

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

    render(
      <MemoryRouter>
        <PoiStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("places:stats.visitedPlaces")).toBeInTheDocument();
    });
    const card = screen.getByText("places:stats.visitedPlaces").closest("div")?.parentElement;
    expect(card?.textContent).toContain("1");
    // And the wishlist entry is reported as such rather than vanishing. The
    // sentence is three nodes since 2026-09-19 — text, the number as a
    // trigger, text — so it is the TAIL that identifies it.
    expect(screen.getByText(/places:stats.wishlistAfter/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "places:stats.wishlistLabel" })).toHaveTextContent(
      "1"
    );
  });

  it("counts an undated visit and says it has no date", async () => {
    listPlacesMock.mockResolvedValue([
      place({
        id: "p1",
        name: "McDonald's Trevi",
        visits: [visit("2023-04-01"), visit(null)] as never,
      }),
    ]);

    render(
      <MemoryRouter>
        <PoiStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );

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

    render(
      <MemoryRouter>
        <PoiStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("places:list.loadError")).toBeInTheDocument();
    });
    expect(screen.queryByText("places:stats.visitedPlaces")).not.toBeInTheDocument();
  });

  it("invites a first visit when there is nothing yet", async () => {
    listPlacesMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <PoiStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("places:stats.empty")).toBeInTheDocument();
    });
  });
});

describe("PoiStatsSection under the page's period", () => {
  beforeEach(() => {
    listPlacesMock.mockReset();
    listPlaceListsMock.mockReset().mockResolvedValue([{ id: "l1", curatedKey: null }]);
    listCuratedMock.mockReset().mockResolvedValue([]);
  });

  const twoYears = [
    place({ id: "p1", name: "Kolosseum", visits: [visit("2023-04-01T10:00:00Z")] as never }),
    place({ id: "p2", name: "Pantheon", visits: [visit("2024-04-01T10:00:00Z")] as never }),
    place({ id: "p3", name: "Trevi", visits: [visit("2024-05-01T10:00:00Z")] as never }),
  ];

  it("counts only the places visited in the chosen year", async () => {
    listPlacesMock.mockResolvedValue(twoYears);
    render(
      <MemoryRouter>
        <PoiStatsSection scope={{ year: 2023, compareYear: null }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    const title = await screen.findByText("places:stats.visitedPlaces");
    // The value itself, not the card's container: that is the whole grid, and
    // "1" is also the country count — this assertion passed with no scoping.
    expect(title.nextElementSibling?.textContent).toBe("1");
  });

  it("leaves lists and the wishlist line out of a year, since they have no date", async () => {
    listPlacesMock.mockResolvedValue(twoYears);
    render(
      <MemoryRouter>
        <PoiStatsSection scope={{ year: 2024, compareYear: null }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    await screen.findByText("places:stats.visitedPlaces");
    expect(screen.queryByText("places:stats.lists")).not.toBeInTheDocument();
    // `visitedPlacesDesc` used to name this line and no longer exists, which
    // made the assertion pass without measuring anything. The line is now a
    // tail plus a trigger, and both have to be gone.
    expect(screen.queryByText(/places:stats.wishlistAfter/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "places:stats.wishlistLabel" })
    ).not.toBeInTheDocument();
  });

  it("sets the year against the compare year", async () => {
    listPlacesMock.mockResolvedValue(twoYears);
    render(
      <MemoryRouter>
        <PoiStatsSection scope={{ year: 2024, compareYear: 2023 }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    expect(await screen.findByText("stats:yearFilter.vs")).toBeInTheDocument();
  });

  it("names the year when nothing was visited in it", async () => {
    listPlacesMock.mockResolvedValue(twoYears);
    render(
      <MemoryRouter>
        <PoiStatsSection scope={{ year: 2019, compareYear: null }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    expect(await screen.findByText("stats:period.emptyYear")).toBeInTheDocument();
    expect(screen.queryByText("places:stats.empty")).not.toBeInTheDocument();
  });
});

describe("PoiStatsSection hides the blocks the reader switched off", () => {
  beforeEach(() => {
    listPlacesMock.mockReset();
    listPlaceListsMock.mockReset().mockResolvedValue([]);
    listCuratedMock.mockReset().mockResolvedValue([]);
  });

  it("drops the rankings and keeps the key figures", async () => {
    listPlacesMock.mockResolvedValue([
      place({ id: "p1", name: "Kolosseum", visits: [visit("2023-04-01")] as never }),
    ]);
    render(
      <MemoryRouter>
        <PoiStatsSection scope={LIFETIME} visibility={hiding("rankings")} />
      </MemoryRouter>
    );
    expect(await screen.findByText("places:stats.visitedPlaces")).toBeInTheDocument();
    expect(screen.queryByText("places:stats.byCategory")).not.toBeInTheDocument();
  });

  it("drops the key figures and keeps the rankings", async () => {
    listPlacesMock.mockResolvedValue([
      place({ id: "p1", name: "Kolosseum", visits: [visit("2023-04-01")] as never }),
    ]);
    render(
      <MemoryRouter>
        <PoiStatsSection scope={LIFETIME} visibility={hiding("kpis")} />
      </MemoryRouter>
    );
    expect(await screen.findByText("places:stats.byCategory")).toBeInTheDocument();
    expect(screen.queryByText("places:stats.visitedPlaces")).not.toBeInTheDocument();
  });
});
