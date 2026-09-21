import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useNavigate: () => vi.fn(),
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    // Interpolates `col`, so the sortable headers get distinct accessible
    // names instead of all answering to the same key.
    t: (k: string, opts?: { col?: string }) => (opts?.col ? `${k}/${opts.col}` : k),
    i18n: { language: "de" },
    ready: true,
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
  // Keeps the HEADER, because the sort lives there.
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
vi.mock("../../components/Cruise/CruiseRow", () => ({
  CruiseRow: ({ cruise }: { cruise: { id: string } }) => <tr data-testid={`row-${cruise.id}`} />,
  CRUISE_COLUMN_LAYOUT: new Proxy({}, { get: () => ({}) }),
}));
vi.mock("../../components/Cruise/CruiseRowActions", () => ({ default: () => null }));
vi.mock("../../components/Cruise/CruiseEditModal", () => ({ CruiseEditModal: () => null }));
vi.mock("../../components/import/DomainImportPanel", () => ({ default: () => null }));
vi.mock("../../components/import/adapters/cruiseAdapter", () => ({
  useCruiseImportAdapter: () => ({}),
}));
vi.mock("../../components/Training/ConfirmModal", () => ({ default: () => null }));
vi.mock("../../components/table/ColumnPicker", () => ({ ColumnPicker: () => null }));

const listPage = vi.fn();
const facets = vi.fn();
vi.mock("../../lib/api", () => ({
  cruiseApi: {
    listPage: (...a: unknown[]) => listPage(...a),
    facets: (...a: unknown[]) => facets(...a),
    remove: vi.fn(),
  },
}));

import CruisesPage from "../CruisesPage";

/**
 * The cruise logbook pages on the SERVER.
 *
 * It did not: `cruiseApi.list()` was called with no arguments, so it took the
 * server's default of 500 rows with no `meta` beside them — from 501 sailings
 * on the list stopped and said nothing — and then filtered, sorted and sliced
 * what it had in the browser. The page-size control underneath therefore
 * changed how many rows were drawn and nothing else.
 *
 * These cases pin the REQUEST, not the rendering: a page size that does not
 * reach `limit` is the defect, whatever the table then shows.
 */
const FACETS = {
  years: [
    { value: 2024, count: 40 },
    { value: 2023, count: 23 },
  ],
  lines: [
    { value: "AIDA Cruises", count: 40 },
    { value: "TUI Cruises", count: 23 },
  ],
  summary: { cruises: 63, portCalls: 210, seaDays: 44, lines: 2 },
};

const page = (n: number) => ({
  items: Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    status: "flown",
    stops: [],
    startDate: "2024-01-01T00:00:00Z",
  })),
  total: 63,
});

const lastQuery = (): Record<string, unknown> =>
  listPage.mock.calls[listPage.mock.calls.length - 1][0] as Record<string, unknown>;

describe("CruisesPage — server-side paging", () => {
  beforeEach(() => {
    localStorage.clear();
    listPage
      .mockReset()
      .mockImplementation(async (q: { q?: string }) => (q?.q ? { items: [], total: 0 } : page(50)));
    facets.mockReset().mockResolvedValue(FACETS);
  });

  it("asks for ONE page, not for every sailing the account owns", async () => {
    render(<CruisesPage />);
    await waitFor(() => expect(listPage).toHaveBeenCalled());
    expect(lastQuery()).toMatchObject({ limit: 50, offset: 0 });
    await waitFor(() => expect(listPage).toHaveBeenCalledTimes(1));
  });

  it("sends the sort with the page", async () => {
    render(<CruisesPage />);
    await waitFor(() => expect(listPage).toHaveBeenCalled());
    expect(lastQuery()).toMatchObject({ sort: "date", order: "desc" });
  });

  it("sends `sort` and `order` when a column header is clicked", async () => {
    render(<CruisesPage />);
    await waitFor(() => expect(listPage).toHaveBeenCalled());

    // Re-queried each time: the header is rebuilt when the sort changes.
    const shipHeader = (): HTMLElement => screen.getByLabelText("list.sortBy/list.columns.ship");

    fireEvent.click(shipHeader());
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: "ship", order: "asc" }));

    fireEvent.click(shipHeader());
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: "ship", order: "desc" }));
  });

  it("page 2 at 25 rows asks for limit 25 and offset 25", async () => {
    render(<CruisesPage />);
    await waitFor(() => expect(listPage).toHaveBeenCalled());

    fireEvent.change(screen.getAllByLabelText("common:table.pagination.pageSize")[0], {
      target: { value: "25" },
    });
    await waitFor(() => expect(lastQuery()).toMatchObject({ limit: 25, offset: 0 }));

    fireEvent.click(screen.getAllByLabelText("common:table.pagination.next")[0]);
    await waitFor(() => expect(lastQuery()).toMatchObject({ limit: 25, offset: 25 }));
  });

  it("returns to page 1 when a facet changes, instead of asking for a page that may not exist", async () => {
    render(<CruisesPage />);
    await waitFor(() => expect(listPage).toHaveBeenCalled());

    fireEvent.click(screen.getAllByLabelText("common:table.pagination.next")[0]);
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 50 }));

    // The line lives behind the "Filter" button, with the other
    // domain-specific controls.
    fireEvent.click(screen.getByTestId("list-filter-more"));
    fireEvent.change(screen.getByLabelText("filter.line"), {
      target: { value: "AIDA Cruises" },
    });
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 0 }));
    // …and the line reaches the server as `shipLine`, which sees a line known
    // only through the ship — `cruiseLine` matches the column and would not.
    expect(lastQuery()).toMatchObject({ shipLine: "AIDA Cruises" });
    expect(lastQuery()).not.toHaveProperty("cruiseLine");
  });

  it("builds the filter dropdowns from the facet endpoint, not from the rows", async () => {
    render(<CruisesPage />);
    await waitFor(() => expect(facets).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("list-filter-more"));
    // 40 AIDA sailings, from a page that carries 50 rows in total.
    expect(screen.getByLabelText("filter.line")).toHaveTextContent("AIDA Cruises");
    expect(screen.getByLabelText("filter.year")).toHaveTextContent("2024");
  });

  it("draws the summary strip from the server's counts, over the whole filtered set", async () => {
    render(<CruisesPage />);
    await waitFor(() => expect(facets).toHaveBeenCalled());
    // 210 port calls and 44 sea days across 63 sailings — numbers 50 rows
    // could not produce.
    await screen.findByText("210");
    await screen.findByText("44");
  });

  it("counts the filtered set from `total`, not from the page", async () => {
    render(<CruisesPage />);
    await waitFor(() => expect(listPage).toHaveBeenCalled());
    await screen.findByText(/63/);
  });

  it("does not ask the facet endpoint again just because the page turned", async () => {
    render(<CruisesPage />);
    await waitFor(() => expect(facets).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByLabelText("common:table.pagination.next")[0]);
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 50 }));
    expect(facets).toHaveBeenCalledTimes(1);
  });

  it("caps a pasted search instead of turning the table red", async () => {
    render(<CruisesPage />);
    await waitFor(() => expect(listPage).toHaveBeenCalled());

    const box = screen.getByPlaceholderText("filter.searchPlaceholder");
    expect(box).toHaveAttribute("maxlength", "100");

    fireEvent.change(box, { target: { value: "z".repeat(150) } });
    await waitFor(() => expect(lastQuery().q).toBe("z".repeat(100)));

    await waitFor(() => expect(screen.getByText("common:filters.noMatch")).toBeInTheDocument());
    expect(screen.queryByText("list.loadError")).toBeNull();
  });
});

/**
 * Source scans, and they are the SECOND line — not the guard.
 *
 * The behavioural cases above read the requests, so they cannot be satisfied
 * by code that merely looks right: "asks for ONE page" fails the moment a
 * whole-account fetch reappears, and "page 2 at 25 rows" fails the moment a
 * page size stops reaching the query. These three read the file's text, which
 * ages in the known way (`feedback_source_scanning_guard_ages`) — a rename or
 * a helper and they go quiet while passing. They earn their place as a cheap
 * tripwire that names the regression's shape to a reviewer. If one has to be
 * loosened to pass, check that the behavioural case still covers it and then
 * delete the scan rather than weaken it.
 */
describe("CruisesPage — nothing is filtered or sliced in the browser", () => {
  const source = readFileSync(resolve(__dirname, "../CruisesPage.tsx"), "utf-8");

  it("keeps no client-side slice, sort or filter over the rows", () => {
    expect(source).not.toContain("sortCruises");
    expect(source).not.toContain("cruises.filter(");
    expect(source).not.toContain("usePagination(");
  });

  it("asks for one page rather than the whole account", () => {
    expect(source).not.toContain("cruiseApi.list()");
    expect(source).toContain("cruiseApi.listPage");
  });

  it("debounces the search rather than querying per keystroke", () => {
    expect(source).toContain("useDebouncedValue");
  });
});
