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

// Measured 2026-09-19: these renders take ~1 s each on a developer machine
// and 6–8 s on the CI runner under coverage instrumentation, past Vitest's
// 5 s default — the first CI run on the merged main (f1e1085c) failed on
// exactly that. A hang would still be caught at 20 s; a slow render is not a
// wrong render.
vi.setConfig({ testTimeout: 20_000 });

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
    getFacets: vi.fn(),
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
    vi.mocked(flightsApi.getFacets).mockResolvedValue({
      years: [],
      airlines: [],
      summary: { flights: 0, airlines: 0, airports: 0, withoutAirline: 0 },
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
  // actually pages the rows — dropping `<TablePagination>` would have left
  // the suite green.
  //
  // Rewritten 2026-09-20, when the paging moved to the server. The old
  // version handed the page all 63 rows and asserted that 50 were drawn,
  // which is now a statement about a client-side slice that no longer
  // exists — and could only pass by reintroducing the very loop the board
  // item ("Seitengröße ist nur Anzeige") was about. What it always meant is
  // below: one page of rows, the pager under them, and a count that reports
  // the whole filtered set.
  it("shows the page the server sent, under a count of the whole filtered set", async () => {
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
    vi.mocked(flightsApi.getAll).mockImplementation(async (filters) => {
      const limit = filters?.limit ?? 100;
      return {
        flights: Array.from({ length: Math.min(limit, 63) }, (_, i) => makeFlight(i)),
        total: 63,
        limit,
        offset: filters?.offset ?? 0,
      };
    });
    vi.mocked(flightsApi.getFacets).mockResolvedValue({
      years: [],
      airlines: [],
      summary: { flights: 63, airlines: 1, airports: 2, withoutAirline: 0 },
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
    // …and it is a page because it was ASKED for as one.
    expect(vi.mocked(flightsApi.getAll).mock.calls[0][0]).toMatchObject({
      limit: 50,
      offset: 0,
    });
    expect(paginationControlsRendered()).toBe(true);
    // The FULL filtered count (63), not the 50 rows the page renders.
    expect(screen.getByText("63")).toBeInTheDocument();
  });
});
