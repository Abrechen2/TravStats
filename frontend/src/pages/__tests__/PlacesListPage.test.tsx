import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Place } from "../../types/place";
import { countRenderedRows, paginationControlsRendered } from "./tablePaginationTestSupport";

const listPlacesMock = vi.fn();

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../lib/api/places", () => ({
  listPlaces: (...args: unknown[]) => listPlacesMock(...args),
  deletePlace: vi.fn(),
}));

// The lists dropdown is a separate concern — an empty list keeps the panel's
// "Filter" button rendering, without pulling in list-membership behaviour.
vi.mock("../../lib/api/placeLists", () => ({
  listPlaceLists: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...args: unknown[]) => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

// Places is domain-gated (usePlacesAccess -> useEnabledDomains); the global
// settingsStore mock's default `enabledDomains` doesn't include "poi", so
// unmocked here the same way LodgingListPage.test.tsx unmocks it for
// baseCurrency — real store, `poi` turned on for this file only.
vi.unmock("../../store/settingsStore");

// Imported after the mocks above so the module graph picks them up.
import PlacesListPage from "../PlacesListPage";
import { useSettingsStore } from "../../store/settingsStore";

function makePlace(overrides: Partial<Place> & Pick<Place, "id" | "name">): Place {
  return {
    category: "landmark",
    lat: 48.9,
    lon: 9.19,
    address: null,
    city: null,
    country: null,
    isoCountryCode: null,
    externalRef: null,
    curatedItemId: null,
    visited: true,
    notes: null,
    dataSource: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    visits: [],
    visitCount: 1,
    plannedVisitCount: 0,
    lastVisitAt: "2024-01-01T00:00:00.000Z",
    continent: null,
    ...overrides,
  };
}

function renderListPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <PlacesListPage />
    </MemoryRouter>
  );
}

describe("PlacesListPage", () => {
  beforeEach(() => {
    listPlacesMock.mockReset();
    useSettingsStore.setState({ enabledDomains: ["flight", "poi"] });
  });

  it("renders the empty state without crashing when there are no places", async () => {
    listPlacesMock.mockResolvedValue([]);

    renderListPage();

    expect(await screen.findByText("places:list.empty")).toBeInTheDocument();
  });

  // Review finding (Alex T7, round 1): nothing tested that the wiring
  // actually pages the rows — reverting `filtered.map` -> `pagination.paged.map`
  // or dropping `<TablePagination>` would have left the suite green. This is
  // also the first render test PlacesListPage has ever had.
  it("shows only one page of rows while the summary strip keeps the full count", async () => {
    // `countries` figure counts by ISO code; every place shares one code
    // ("DE"), and `visitCount: 0` keeps the "visited" figure from
    // coincidentally also summing to 63.
    const places = Array.from({ length: 63 }, (_, i) =>
      makePlace({
        id: `p-${i}`,
        name: `Place ${i}`,
        isoCountryCode: "DE",
        visited: false,
        visitCount: 0,
      })
    );
    listPlacesMock.mockResolvedValue(places);

    const { container } = renderListPage();

    await waitFor(() => {
      expect(countRenderedRows(container)).toBe(50); // default page size
    });
    expect(paginationControlsRendered()).toBe(true);
    // The FULL filtered count (63), not the 50 rows the page renders.
    expect(screen.getByText("63")).toBeInTheDocument();
  });
});
