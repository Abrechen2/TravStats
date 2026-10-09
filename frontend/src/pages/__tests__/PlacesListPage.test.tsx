import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Place } from "../../types/place";
import { countRenderedRows, paginationControlsRendered } from "./tablePaginationTestSupport";

const listPlacesMock = vi.fn();
const getPlaceRelationsMock = vi.fn();
const createVisitMock = vi.fn();

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../lib/api/places", () => ({
  listPlaces: (...args: unknown[]) => listPlacesMock(...args),
  deletePlace: vi.fn(),
  getPlaceRelations: (...args: unknown[]) => getPlaceRelationsMock(...args),
  createVisit: (...args: unknown[]) => createVisitMock(...args),
  getVisitDateSuggestions: vi.fn(async () => []),
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

vi.mock("../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn(async () => []) } }));

// Imported after the mocks above so the module graph picks them up.
import PlacesListPage from "../PlacesListPage";
import { useSettingsStore } from "../../store/settingsStore";

// Measured 2026-09-19: this page's paged-rows case renders in about a second
// on a developer machine and past Vitest's 5 s default on the CI runner under
// coverage instrumentation — the merge dbcda8d2 went red on exactly that.
// A hang is still caught at 20 s; a slow render is not a wrong render.
vi.setConfig({ testTimeout: 20_000 });

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

  // forgejo#250: the genuinely empty list names its next step, right there.
  it("offers the first place from the empty, unfiltered list", async () => {
    listPlacesMock.mockResolvedValue([]);
    renderListPage();

    fireEvent.click(await screen.findByRole("button", { name: "places:list.addFirst" }));
    expect(await screen.findByText("places:form.createTitle")).toBeInTheDocument();
  });

  // forgejo#247: a list that could not be read is not an empty one, and the
  // way forward is a retry that reads it again.
  it("tells a failed load from an empty list and retries it", async () => {
    listPlacesMock
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
      .mockResolvedValueOnce([makePlace({ id: "p1", name: "Wartburg" })]);
    renderListPage();

    expect(await screen.findByText("places:list.loadError")).toBeInTheDocument();
    expect(screen.queryByText("places:list.empty")).not.toBeInTheDocument();
    expect(screen.getByText("HTTP 503")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByText("Wartburg")).toBeInTheDocument();
    expect(listPlacesMock).toHaveBeenCalledTimes(2);
  });

  // forgejo#250: the list asks the same question as the detail page — what
  // goes with the place and what stays — counted only once it is asked.
  it("names what goes and what stays before deleting from the list", async () => {
    listPlacesMock.mockResolvedValue([
      makePlace({ id: "p1", name: "Wartburg", visitCount: 1, plannedVisitCount: 1 }),
    ]);
    getPlaceRelationsMock.mockResolvedValue({
      visitCount: 2,
      plannedVisitCount: 1,
      photoCount: 2,
      documentCount: 0,
      lists: [],
      trips: [{ id: "t1", name: "Thüringen" }],
      roadtripStationCount: 0,
    });
    renderListPage();
    await screen.findByText("Wartburg");
    expect(getPlaceRelationsMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "common:buttons.delete" })[0]);
    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(dialog.textContent).toContain("places:delete.photos"));
    expect(getPlaceRelationsMock).toHaveBeenCalledWith("p1");
    expect(dialog.textContent).toContain("common:delete.survivors");
  });

  // forgejo#231: a visit straight from the row, without opening the place.
  it("records a visit from the row and re-reads the rows afterwards", async () => {
    listPlacesMock.mockResolvedValue([makePlace({ id: "p1", name: "Wartburg", visited: false })]);
    createVisitMock.mockResolvedValue({ id: "v1" });
    renderListPage();
    await screen.findByText("Wartburg");

    fireEvent.click(screen.getByRole("button", { name: "places:visit.action" }));
    const save = await screen.findByRole("button", { name: "common:buttons.save" });
    fireEvent.click(save);

    await waitFor(() => expect(createVisitMock).toHaveBeenCalledTimes(1));
    expect(createVisitMock.mock.calls[0][0]).toBe("p1");
    await waitFor(() => expect(listPlacesMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "common:buttons.save" })).not.toBeInTheDocument()
    );
  });

  // The add button was filled with the place domain colour, which is an
  // off-white (#e7e3dc) — every other logbook's add button is the shared
  // yellow `btn-primary`, so this one read as a disabled control.
  it("draws the add button as the shared primary button, like the other logbooks", async () => {
    listPlacesMock.mockResolvedValue([]);

    renderListPage();

    const add = await screen.findByRole("button", { name: /places:list\.addPlace/ });
    expect(add).toHaveClass("btn-primary");
    expect(add.style.background).toBe("");
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

  // forgejo#199: a place with a second name shows it after the readable one.
  it("shows a place's local name beside its name", async () => {
    listPlacesMock.mockResolvedValue([
      makePlace({ id: "p1", name: "Banpo Bridge", localName: "반포대교" }),
    ]);

    renderListPage();

    expect(await screen.findByText("반포대교")).toBeInTheDocument();
    expect(screen.getByText("Banpo Bridge")).toBeInTheDocument();
  });
});
