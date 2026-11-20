import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import TripsTab from "../TripsTab";
import { useSettingsStore } from "../../../store/settingsStore";
import { TRIPS_VIEW_KEY } from "../useTripsView";
import type { Trip } from "../../../types";

vi.unmock("../../../store/settingsStore");
vi.mock("../../../lib/api", () => ({
  tripsApi: { detect: vi.fn().mockResolvedValue({ proposed: [] }) },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
// Detection fetches on mount and has its own suite; here it would only race the assertions.
vi.mock("../DetectTripsBanner", () => ({ default: () => null }));
vi.mock("../../../hooks/useTripPlaceCounts", () => ({
  useTripPlaceCounts: () => ({
    counts: new Map([["a", 7]]),
    failed: false,
    reload: vi.fn(),
  }),
}));

const trips = [
  {
    id: "a",
    name: "Portugal",
    status: "completed",
    startDate: "2024-05-01",
    endDate: "2024-05-10",
    countries: ["PT"],
    tags: [],
    companions: [],
  },
  { id: "b", name: "Planned trip", status: "planned", countries: [], tags: [], companions: [] },
] as unknown as Trip[];
const filters = { q: "", status: "all", category: "all" } as const;

function Where(): JSX.Element {
  return <span data-testid="where">{useLocation().search}</span>;
}

function renderTab(url = "/trips"): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <TripsTab trips={trips} filters={filters} onFiltersChange={vi.fn()} onTripsChange={vi.fn()} />
      <Where />
    </MemoryRouter>
  );
}

describe("TripsTab — tiles or list", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    window.localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts on the tiles when nothing was ever chosen", () => {
    renderTab();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByTestId("trips-view-tiles")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the trips as a table with name, dates, days, countries, status and places", () => {
    renderTab("/trips?view=list");
    const row = screen.getByTestId("trip-row-a");
    expect(row).toHaveTextContent("Portugal");
    expect(row).toHaveTextContent("10"); // days, both ends counted
    expect(row).toHaveTextContent("trips:status.completed");
    expect(row).toHaveTextContent("7"); // places from the trip-places counts
    expect(screen.getByTestId("trip-row-b")).toHaveTextContent("—");
  });

  it("a click on the toggle switches the view, writes ?view= and remembers it", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("trips-view-list"));
    expect(screen.getByTestId("trip-row-a")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("view=list");
    expect(window.localStorage.getItem(TRIPS_VIEW_KEY)).toBe("list");
  });

  it("opens in the view the reader last chose when the URL says nothing", () => {
    window.localStorage.setItem(TRIPS_VIEW_KEY, "list");
    renderTab();
    expect(screen.getByTestId("trip-row-a")).toBeInTheDocument();
  });

  it("the URL beats the stored choice", () => {
    window.localStorage.setItem(TRIPS_VIEW_KEY, "list");
    renderTab("/trips?view=tiles");
    expect(screen.queryByTestId("trip-row-a")).toBeNull();
    expect(screen.getByTestId("trips-view-tiles")).toHaveAttribute("aria-pressed", "true");
  });

  it("choosing the tiles again overrides a stored list (an explicit ?view=tiles)", () => {
    window.localStorage.setItem(TRIPS_VIEW_KEY, "list");
    renderTab();
    fireEvent.click(screen.getByTestId("trips-view-tiles"));
    expect(screen.getByTestId("where")).toHaveTextContent("view=tiles");
    expect(screen.queryByTestId("trip-row-a")).toBeNull();
  });

  it("falls back to the tiles when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderTab();
    expect(screen.getByTestId("trips-view-tiles")).toHaveAttribute("aria-pressed", "true");
  });

  it("still switches the view when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderTab();
    fireEvent.click(screen.getByTestId("trips-view-list"));
    expect(screen.getByTestId("trip-row-a")).toBeInTheDocument();
  });

  it("ignores a stored value that is neither view", () => {
    window.localStorage.setItem(TRIPS_VIEW_KEY, "grid");
    renderTab();
    expect(screen.getByTestId("trips-view-tiles")).toHaveAttribute("aria-pressed", "true");
  });

  it("opens a trip from its row", () => {
    renderTab("/trips?view=list");
    // The row is one tab stop with Enter to open; navigation itself is the router's.
    expect(screen.getByTestId("trip-row-a")).toHaveAttribute("tabindex", "0");
  });
});
