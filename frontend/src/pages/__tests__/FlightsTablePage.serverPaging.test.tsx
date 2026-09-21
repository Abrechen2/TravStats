import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    // Interpolates `col`, so the four sortable headers get four distinct
    // accessible names instead of all answering to the same key.
    t: (k: string, opts?: { col?: string }) => (opts?.col ? `${k}/${opts.col}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/table/LogbookTabs", () => ({ default: () => null }));
vi.mock("../../components/ui/Table", () => ({
  // Keeps the HEADER, because the sort lives there: the real primitive needs
  // a layout the test environment has no width for.
  Table: ({
    columns,
    children,
  }: {
    columns: Array<{ key: string; label: React.ReactNode }>;
    children: React.ReactNode;
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  ),
}));
vi.mock("../../components/flightsTable/FlightRow", () => ({
  FlightRow: ({ flight }: { flight: { id: string } }) => <tr data-testid={`row-${flight.id}`} />,
  FLIGHT_COLUMN_LAYOUT: new Proxy({}, { get: () => ({}) }),
}));
vi.mock("../../components/SimplifiedFlightFormV2", () => ({ default: () => null }));
vi.mock("../../components/SpecialFlightModal", () => ({ default: () => null }));
vi.mock("../../components/FlightEditModal", () => ({ default: () => null }));
vi.mock("../../components/FlightRowActions", () => ({ default: () => null }));
vi.mock("../../components/Training/ConfirmModal", () => ({ default: () => null }));
vi.mock("../../components/table/ColumnPicker", () => ({ ColumnPicker: () => null }));

const getAll = vi.fn();
const getFacets = vi.fn();
const tripsGetAll = vi.fn();
vi.mock("../../lib/api", () => ({
  flightsApi: {
    getAll: (...a: unknown[]) => getAll(...a),
    getFacets: (...a: unknown[]) => getFacets(...a),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tripsApi: { getAll: (...a: unknown[]) => tripsGetAll(...a) },
}));

import FlightsTablePage from "../FlightsTablePage";

/**
 * The flights logbook pages on the SERVER.
 *
 * It did not, until 2026-09-20: it looped `GET /flights?limit=500` until the
 * account was exhausted, held every row, and sliced the tail for display —
 * because the filter bar's option lists, the summary strip and the sort all
 * worked over the complete set. The board item called it "Seitengröße ist nur
 * Anzeige", which was exactly right.
 *
 * What these cases pin is the REQUEST, not the rendering: a page size that
 * does not reach `limit` is the defect, whatever the table then shows.
 */
const FACETS = {
  years: [
    { value: 2024, count: 100 },
    { value: 2023, count: 74 },
  ],
  airlines: [
    { value: "Lufthansa", count: 120 },
    { value: "Austrian Airlines", count: 54 },
  ],
  summary: { flights: 174, airlines: 2, airports: 30, withoutAirline: 0 },
};

const page = (n: number) => ({
  flights: Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    status: "flown",
    depIata: "MUC",
    arrIata: "CPH",
  })),
  total: 174,
  limit: n,
  offset: 0,
});

const lastQuery = (): Record<string, unknown> =>
  getAll.mock.calls[getAll.mock.calls.length - 1][0] as Record<string, unknown>;

describe("FlightsTablePage — server-side paging", () => {
  beforeEach(() => {
    localStorage.clear();
    getAll.mockReset().mockImplementation(async (filters: { q?: string }) =>
      // A search nothing matches answers with an empty page, like the server.
      filters?.q ? { flights: [], total: 0, limit: 50, offset: 0 } : page(50)
    );
    getFacets.mockReset().mockResolvedValue(FACETS);
    tripsGetAll.mockReset().mockResolvedValue([]);
  });

  it("asks for ONE page, not for every flight the account owns", async () => {
    render(<FlightsTablePage />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(lastQuery()).toMatchObject({ limit: 50, offset: 0 });
    // One request. The loop made 1 + ceil(total / 500) of them.
    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(1));
  });

  it("sends the sort with the page", async () => {
    render(<FlightsTablePage />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(lastQuery()).toMatchObject({ sort: "departureTime", order: "desc" });
  });

  it("sends `sort` and `order` when a column header is clicked", async () => {
    render(<FlightsTablePage />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    // Re-queried each time: the header is rebuilt when the sort state changes,
    // so a held reference would click a node that is no longer in the tree.
    const airlineHeader = (): HTMLElement =>
      screen.getByLabelText("flights:table.sortBy/flights:table.airline");

    fireEvent.click(airlineHeader());
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: "airline", order: "desc" }));

    // A second click on the same column flips the direction; it does not ask
    // for a different column.
    fireEvent.click(airlineHeader());
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: "airline", order: "asc" }));
  });

  it("page 2 at 25 rows asks for limit 25 and offset 25", async () => {
    render(<FlightsTablePage />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    fireEvent.change(screen.getAllByLabelText("common:table.pagination.pageSize")[0], {
      target: { value: "25" },
    });
    await waitFor(() => expect(lastQuery()).toMatchObject({ limit: 25, offset: 0 }));

    fireEvent.click(screen.getAllByLabelText("common:table.pagination.next")[0]);
    await waitFor(() => expect(lastQuery()).toMatchObject({ limit: 25, offset: 25 }));
  });

  it("returns to page 1 when a facet changes, instead of asking for a page that may not exist", async () => {
    render(<FlightsTablePage />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    fireEvent.click(screen.getAllByLabelText("common:table.pagination.next")[0]);
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 50 }));

    // The carrier lives behind the "Filter" button, with the other
    // domain-specific controls.
    fireEvent.click(screen.getByTestId("list-filter-more"));
    fireEvent.change(screen.getByLabelText("flights:table.airline"), {
      target: { value: "Lufthansa" },
    });
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 0 }));
    // …and the carrier reaches the server as an EXACT name, not a substring.
    expect(lastQuery()).toMatchObject({ airlineExact: "Lufthansa" });
    // No request was spent on offset 50 under the new filter.
    const withNewFilter = getAll.mock.calls.filter(
      (call) => (call[0] as { airlineExact?: string }).airlineExact === "Lufthansa"
    );
    expect(withNewFilter.every((call) => (call[0] as { offset: number }).offset === 0)).toBe(true);
  });

  it("builds the filter dropdowns from the facet endpoint, not from the rows", async () => {
    render(<FlightsTablePage />);
    await waitFor(() => expect(getFacets).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("list-filter-more"));
    const airlineSelect = screen.getByLabelText("flights:table.airline");
    expect(airlineSelect).toHaveTextContent("Lufthansa (120)");
    // 120 Lufthansa flights, from a page that carries 50 rows in total.
    expect(screen.getByLabelText("flights:filter.year")).toHaveTextContent("2024");
  });

  it("counts the filtered set from `total`, not from the page", async () => {
    render(<FlightsTablePage />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    // "174 treffen zu" over 50 rows, and "1–50 von 174" underneath.
    await screen.findByText(/174/);
  });

  it("caps a pasted search instead of turning the table red", async () => {
    render(<FlightsTablePage />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    const box = screen.getByPlaceholderText("flights:filter.searchPlaceholder");
    expect(box).toHaveAttribute("maxlength", "100");

    // jsdom's change event ignores maxLength, which is the point: the guard
    // that matters is the truncation on the way to the query.
    fireEvent.change(box, { target: { value: "z".repeat(150) } });
    await waitFor(() => expect(lastQuery().q).toBe("z".repeat(100)));

    // And the page reads as "nothing matched", not as "this is broken".
    // "Nichts gefunden" + a way back out, which is what an active filter's
    // empty state says — not the genuinely-empty headline, and not an error.
    await waitFor(() => expect(screen.getByText("common:filters.noMatch")).toBeInTheDocument());
    expect(screen.queryByText("flights:table.loadError")).toBeNull();
  });

  it("does not ask the facet endpoint again just because the page turned", async () => {
    render(<FlightsTablePage />);
    await waitFor(() => expect(getFacets).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByLabelText("common:table.pagination.next")[0]);
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 50 }));
    expect(getFacets).toHaveBeenCalledTimes(1);
  });
});

/**
 * Source scans, and they are the SECOND line — not the guard.
 *
 * What actually holds this page to one-page fetching are the behavioural
 * cases above: "asks for ONE page", which fails the moment a loop reappears,
 * and "page 2 at 25 rows asks for limit 25 and offset 25", which fails the
 * moment a page size stops reaching the query. Those read the requests, so
 * they cannot be satisfied by code that merely looks right.
 *
 * These three read the file's text, which ages badly in a known way
 * (`feedback_source_scanning_guard_ages`): rename `flights`, move the slice
 * into a helper, or write `.slice (` and they go quiet while passing. They
 * earn their place as a cheap tripwire for the shape of a regression — a
 * reviewer reintroducing `displayedFlights` gets told immediately, by name —
 * and for nothing more. If one of them ever has to be loosened to pass, the
 * question is whether the behavioural case above still covers it; if it does,
 * delete the scan rather than weaken it.
 */
describe("FlightsTablePage — nothing is filtered or sliced in the browser", () => {
  const source = readFileSync(resolve(__dirname, "../FlightsTablePage.tsx"), "utf-8");

  it("keeps no client-side slice, sort or filter over the rows", () => {
    expect(source).not.toContain(".slice(");
    expect(source).not.toContain("flights.filter(");
    expect(source).not.toContain("sortedFlights");
    expect(source).not.toContain("displayedFlights");
  });

  it("no longer loops until the account is exhausted", () => {
    expect(source).not.toContain("MAX_PAGES");
    expect(source).not.toContain("MAX_PAGE_SIZE");
    expect(source).not.toContain("while (");
  });

  it("debounces the search rather than querying per keystroke", () => {
    expect(source).toContain("useDebouncedValue");
  });
});
