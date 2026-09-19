import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FlightsTablePage from "../../pages/FlightsTablePage";
import { flightsApi, tripsApi } from "../../lib/api";
import type { Flight } from "../../types";
import {
  countRenderedRows,
  paginationControlsRendered,
} from "../../pages/__tests__/tablePaginationTestSupport";

/**
 * FlightsTablePage pulls in many heavy siblings (filters, modals, table
 * cells). None of them matter for this test — only the header's link to
 * the central import hub does — so every sibling is stubbed at the module
 * boundary, following the CruisesPage.test.tsx convention.
 */
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));

vi.mock("../../components/Filters", () => ({
  default: () => <div data-testid="filters-stub" />,
}));

vi.mock("../../components/SimplifiedFlightFormV2", () => ({
  default: () => <div data-testid="add-flight-form-stub" />,
}));

vi.mock("../../components/SpecialFlightModal", () => ({
  default: () => <div data-testid="special-flight-modal-stub" />,
}));

vi.mock("../../components/FlightEditModal", () => ({
  default: () => <div data-testid="flight-edit-modal-stub" />,
}));

vi.mock("../../components/Training/ConfirmModal", () => ({
  default: () => <div data-testid="confirm-modal-stub" />,
}));

vi.mock("../../components/SkeletonLoader", () => ({
  SkeletonTable: () => <div data-testid="skeleton-table-stub" />,
}));

// Mock framer-motion to avoid animation-triggered state updates outside
// act() — PageTransition wraps every page in a motion.div.
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...args: unknown[]) => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

vi.mock("../../lib/api", () => ({
  flightsApi: {
    getAll: vi.fn(),
  },
  tripsApi: {
    getAll: vi.fn(),
  },
}));

describe("FlightsTablePage", () => {
  it("links to the central import hub in settings", async () => {
    vi.mocked(flightsApi.getAll).mockResolvedValue({
      flights: [],
      total: 0,
      limit: 100,
      offset: 0,
    });
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <FlightsTablePage />
      </MemoryRouter>
    );

    const link = await screen.findByRole("link", { name: /settings:import.openHub/ });
    expect(link.getAttribute("href")).toBe("/settings/data?section=import");
  });

  // Review finding (Alex T7, round 1): nothing tested that the wiring
  // actually pages the rows — reverting `displayedFlights.map` ->
  // `pagination.paged.map` or dropping `<TablePagination>` would have left
  // the suite green.
  it("shows only one page of rows while the summary strip keeps the full count", async () => {
    const makeFlight = (i: number): Flight => ({
      id: `f-${i}`,
      userId: "u1",
      airline: "LH",
      flightNumber: `LH${100 + i}`,
      depIata: "AAA",
      depLat: 0,
      depLon: 0,
      arrIata: "BBB",
      arrLat: 0,
      arrLon: 0,
      departureTime: "2026-01-01T00:00:00.000Z",
      arrivalTime: "2026-01-01T02:00:00.000Z",
      status: "flown",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const flights = Array.from({ length: 63 }, (_, i) => makeFlight(i));
    vi.mocked(flightsApi.getAll).mockResolvedValue({
      flights,
      total: flights.length,
      limit: 500,
      offset: 0,
    });
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);

    const { container } = render(
      <MemoryRouter>
        <FlightsTablePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(countRenderedRows(container)).toBe(50); // default page size
    });
    expect(paginationControlsRendered()).toBe(true);
    // The FULL filtered count (63), not the 50 rows the page renders.
    expect(screen.getByText("63")).toBeInTheDocument();
  });
});
