import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CruisesPage from "../../pages/CruisesPage";
import { cruiseApi } from "../../lib/api";
import type { Cruise } from "../../types";
import type { CruiseFacets } from "../../lib/api/cruise";
import {
  countRenderedRows,
  paginationControlsRendered,
} from "../../pages/__tests__/tablePaginationTestSupport";

// Heavy sibling component with its own auth/domain/pending-updates
// dependencies — irrelevant to sort/delete behaviour, stub it out.
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));

// `t` echoes the key, appending interpolated options so sort-column
// buttons (which pass `{ col: ... }`) and the delete-confirm dialog
// (which passes `{ ship: ... }`) still produce distinguishable strings.
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>): string => {
      if (options && Object.keys(options).length > 0) {
        const parts = Object.entries(options)
          .map(([k, v]) => `${k}:${String(v)}`)
          .join(",");
        return `${key}(${parts})`;
      }
      return key;
    },
    i18n: { language: "en" },
    ready: true,
  }),
}));

vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...args: unknown[]) => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

const mockNavigate = vi.fn();
import { MemoryRouter } from "react-router-dom";

// Measured 2026-09-19: this page's paged-rows case renders in about a second
// on a developer machine and past Vitest's 5 s default on the CI runner under
// coverage instrumentation — the merge dbcda8d2 went red on exactly that.
// A hang is still caught at 20 s; a slow render is not a wrong render.
vi.setConfig({ testTimeout: 20_000 });

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../../lib/api", () => ({
  cruiseApi: {
    listPage: vi.fn(),
    facets: vi.fn(),
    remove: vi.fn(),
  },
}));

/**
 * Builder for a minimal Cruise fixture — the full Cruise interface has many
 * required fields irrelevant to the sort/delete tests, so we compose a
 * default and only override the bits each case cares about.
 */
const makeCruise = (overrides: Partial<Cruise> & Pick<Cruise, "id">): Cruise => ({
  userId: "u1",
  shipId: null,
  ship: null,
  shipNameOverride: "Ship",
  cruiseLine: "Line",
  routeName: null,
  departurePortId: null,
  departurePort: null,
  arrivalPortId: null,
  arrivalPort: null,
  startDate: null,
  endDate: null,
  status: "scheduled",
  color: null,
  cabinNumber: null,
  cabinType: null,
  deck: null,
  bookingReference: null,
  price: null,
  currency: null,
  notes: null,
  tags: [],
  companions: [],
  tripId: null,
  bookingId: null,
  stops: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

/** The facet endpoint's answer, shaped from the fixture the case sets up. */
const facetsFor = (cruises: Cruise[]): CruiseFacets => ({
  years: [],
  lines: [],
  summary: { cruises: cruises.length, portCalls: 0, seaDays: 0, lines: 0 },
});

/** One page of the given cruises, with the filtered total beside it. */
const pageOf = (cruises: Cruise[]) => async (query?: { limit?: number; offset?: number }) => {
  const limit = query?.limit ?? 50;
  const offset = query?.offset ?? 0;
  return { items: cruises.slice(offset, offset + limit), total: cruises.length };
};

describe("CruisesPage", () => {
  /**
   * Rewritten 2026-09-20, when the ordering moved to the server.
   *
   * It used to hand the page two cruises and assert that clicking the header
   * swapped them, which is a statement about a browser sort that no longer
   * exists — and could only pass by reintroducing the whole-account fetch it
   * needed. What it always meant is what it checks now: the click toggles the
   * direction, and the direction is what the server is ASKED for. Which rows
   * come back is the server's answer, pinned by
   * `cruises.listQuery.test.ts`.
   */
  it("toggles sort order and asks the server for it when a column header is clicked", async () => {
    const cruises = [
      makeCruise({ id: "a", shipNameOverride: "Early Ship", startDate: "2026-01-10" }),
      makeCruise({ id: "b", shipNameOverride: "Late Ship", startDate: "2026-06-10" }),
    ];
    vi.mocked(cruiseApi.listPage).mockImplementation(pageOf(cruises));
    vi.mocked(cruiseApi.facets).mockResolvedValue(facetsFor(cruises));

    render(
      <MemoryRouter>
        <CruisesPage />
      </MemoryRouter>
    );

    await screen.findByRole("table");
    const lastSort = (): { sort?: string; order?: string } => {
      const calls = vi.mocked(cruiseApi.listPage).mock.calls;
      return calls[calls.length - 1]?.[0] ?? {};
    };

    // Default sort is date/desc — newest first.
    expect(lastSort()).toMatchObject({ sort: "date", order: "desc" });

    await userEvent.click(screen.getByRole("button", { name: /columns\.dates/ }));

    // Clicking the already-active "date" header toggles to asc.
    await waitFor(() => expect(lastSort()).toMatchObject({ sort: "date", order: "asc" }));
  });

  it("opens the delete-confirm dialog when a row's Delete action is clicked", async () => {
    const cruise = makeCruise({
      id: "a",
      shipNameOverride: "Solo Ship",
      startDate: "2026-01-10",
    });
    vi.mocked(cruiseApi.listPage).mockImplementation(pageOf([cruise]));
    vi.mocked(cruiseApi.facets).mockResolvedValue(facetsFor([cruise]));

    render(
      <MemoryRouter>
        <CruisesPage />
      </MemoryRouter>
    );

    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.delete" }));

    const dialog = await screen.findByRole("dialog");
    // The list and the detail page share these keys now — deleting a cruise
    // used to read differently depending on which of the two you stood on.
    // `…NoStops` rather than the counted form because this fixture has none:
    // asserting WHICH key appeared proves the count branch was taken, which
    // the raw-key test harness cannot show through the rendered number.
    const message = within(dialog).getByText(/deleteConfirmMessageNoStops/);
    // …and it names the ship, which this dialog never did before.
    expect(message.textContent).toContain("Solo Ship");
  });

  // Review finding (Alex T7, round 1): nothing tested that the wiring
  // actually pages the rows — dropping `<TablePagination>` would have left
  // the suite green.
  //
  // Rewritten 2026-09-20 with the paging: the old version handed the page all
  // 63 rows and asserted 50 were drawn, which is a statement about a slice
  // that no longer happens here. What it always meant is below — one page of
  // rows, the pager under them, and a count of the whole filtered set.
  it("shows the page the server sent, under a count of the whole filtered set", async () => {
    const cruises = Array.from({ length: 63 }, (_, i) =>
      makeCruise({ id: `c-${i}`, shipNameOverride: `Ship ${i}`, startDate: "2026-01-10" })
    );
    vi.mocked(cruiseApi.listPage).mockImplementation(pageOf(cruises));
    vi.mocked(cruiseApi.facets).mockResolvedValue(facetsFor(cruises));

    const { container } = render(
      <MemoryRouter>
        <CruisesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(countRenderedRows(container)).toBe(50); // default page size
    });
    // …and it is a page because it was ASKED for as one.
    expect(vi.mocked(cruiseApi.listPage).mock.calls[0][0]).toMatchObject({
      limit: 50,
      offset: 0,
    });
    expect(paginationControlsRendered()).toBe(true);
    // The FULL filtered count (63), not the 50 rows the page renders.
    expect(screen.getByText("63")).toBeInTheDocument();
  });
});
