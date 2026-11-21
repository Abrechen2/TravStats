import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

let placesVisible = true;
vi.mock("../../../hooks/usePlacesVisible", () => ({ usePlacesVisible: () => placesVisible }));
vi.mock("../../../hooks/usePlaceCategories", () => ({
  usePlaceCategories: () => ({ customs: [] }),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import TripPlacesList, { groupByDay } from "../TripPlacesList";
import type { TripPlaceVisits } from "../../../hooks/useTripPlaceVisits";

const pv = (id: string, name: string, visitedAt: string | null, orderIdx = 0): never =>
  ({
    place: { id, name, category: "landmark" },
    visit: { id: `v-${id}`, placeId: id, tripId: "t1", visitedAt, orderIdx },
  }) as never;

function make(over: Partial<TripPlaceVisits> = {}): TripPlaceVisits {
  return { placeVisits: [], failed: false, loading: false, reload: vi.fn(), ...over };
}

function renderList(places: TripPlaceVisits): void {
  render(
    <MemoryRouter>
      <TripPlacesList places={places} />
    </MemoryRouter>
  );
}

describe("TripPlacesList", () => {
  beforeEach(() => {
    placesVisible = true;
  });

  it("lists every visit as a link to its place, day by day, undated last", () => {
    renderList(
      make({
        placeVisits: [
          pv("p3", "Undated", null),
          pv("p2", "Second day", "2024-05-15T10:00:00.000Z"),
          pv("p1", "First day", "2024-05-14T10:00:00.000Z"),
        ],
      })
    );
    const links = within(screen.getByTestId("trip-places-scroll")).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringContaining("First day"),
      expect.stringContaining("Second day"),
      expect.stringContaining("Undated"),
    ]);
    expect(links[0]).toHaveAttribute("href", "/places/p1");
    expect(screen.getByTestId("trip-places-scroll")).toHaveClass("overflow-y-auto");
  });

  it("marks a future-dated visit as planned and leaves a past one unmarked", () => {
    renderList(
      make({
        placeVisits: [
          pv("p1", "Done", "2020-05-14T10:00:00.000Z"),
          pv("p2", "Later", "2999-05-14T10:00:00.000Z"),
        ],
      })
    );
    const planned = screen.getAllByTestId("trip-place-planned");
    expect(planned).toHaveLength(1);
    expect(planned[0].closest("li")).toHaveTextContent("Later");
  });

  it("says a trip without places has none, instead of drawing an empty list", () => {
    renderList(make());
    expect(screen.getByTestId("trip-places-empty")).toHaveTextContent(
      "trips:overview.places.empty"
    );
    expect(screen.queryByTestId("trip-places-scroll")).toBeNull();
  });

  it("says the load failed and offers a retry, never an empty list", async () => {
    const reload = vi.fn();
    renderList(make({ failed: true, reload }));
    expect(screen.getByTestId("trip-places-error")).toBeInTheDocument();
    expect(screen.queryByTestId("trip-places-empty")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "trips:tripPlaces.retry" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("draws nothing when the places domain is off", () => {
    placesVisible = false;
    renderList(make({ placeVisits: [pv("p1", "A", "2020-05-14T10:00:00.000Z")] }));
    expect(screen.queryByTestId("trip-places-panel")).toBeNull();
  });
});

describe("groupByDay", () => {
  it("orders visits within a day by their order", () => {
    const g = groupByDay([
      pv("b", "B", "2024-05-14T10:00:00.000Z", 2),
      pv("a", "A", "2024-05-14T10:00:00.000Z", 1),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].rows.map((r) => r.place.id)).toEqual(["a", "b"]);
  });
});
