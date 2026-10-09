import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// The URL the page was opened at — a loyalty link sets `membership` and `year`.
const urlParams = vi.hoisted(() => ({ current: "" }));
vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(urlParams.current), vi.fn()],
}));
const getLoyaltyMembership = vi.fn();
vi.mock("../../lib/api/loyalty", () => ({
  getLoyaltyMembership: (...a: unknown[]) => getLoyaltyMembership(...a),
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
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
  // The actions cell is where the selection tick lives.
  FlightRow: ({ flight, actions }: { flight: { id: string }; actions: React.ReactNode }) => (
    <tr data-testid={`row-${flight.id}`}>
      <td>{actions}</td>
    </tr>
  ),
  FLIGHT_COLUMN_LAYOUT: new Proxy({}, { get: () => ({}) }),
}));
vi.mock("../../components/flightsTable/bulk/FlightBulkEditModal", () => ({
  default: ({ flights }: { flights: Array<{ id: string }> }) => (
    <div data-testid="bulk-modal">{flights.map((f) => f.id).join(",")}</div>
  ),
}));
vi.mock("../../components/SimplifiedFlightFormV2", () => ({
  default: () => <div data-testid="add-flight-form" />,
}));
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

const FLIGHTS = ["f1", "f2", "f3"].map((id) => ({
  id,
  status: "flown",
  flightNumber: id.toUpperCase(),
  depIata: "MUC",
  arrIata: "CPH",
}));

/** forgejo#217 — an EXPLICIT selection, then one dialog for trip, tags and companions. */
describe("FlightsTablePage bulk selection", () => {
  beforeEach(() => {
    urlParams.current = "";
    getAll.mockReset().mockResolvedValue({ flights: FLIGHTS, total: 3, limit: 25, offset: 0 });
    getFacets.mockReset().mockResolvedValue({
      years: [],
      airlines: [],
      summary: { flights: 3, airlines: 0, airports: 2, withoutAirline: 3 },
    });
    tripsGetAll.mockReset().mockResolvedValue([]);
  });

  it("shows no ticks until the user chooses to select", async () => {
    render(<FlightsTablePage />);
    await screen.findByTestId("row-f1");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByTestId("flight-bulk-bar")).toBeNull();
  });

  it("edits exactly the ticked flights", async () => {
    render(<FlightsTablePage />);
    await screen.findByTestId("row-f1");
    fireEvent.click(screen.getByRole("button", { name: "flights:bulk.start" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /"name":"F1 MUC → CPH"/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /"name":"F3 MUC → CPH"/ }));
    expect(screen.getByTestId("flight-bulk-bar")).toHaveTextContent(
      'flights:bulk.selected {"count":2}'
    );
    fireEvent.click(screen.getByRole("button", { name: /flights:bulk\.edit/ }));
    expect(screen.getByTestId("bulk-modal")).toHaveTextContent("f1,f3");
  });

  it("selects the page on request, and ending the selection forgets it", async () => {
    render(<FlightsTablePage />);
    await screen.findByTestId("row-f1");
    fireEvent.click(screen.getByRole("button", { name: "flights:bulk.start" }));
    fireEvent.click(screen.getByRole("button", { name: "flights:bulk.selectPage" }));
    expect(screen.getAllByRole("checkbox").every((c) => (c as HTMLInputElement).checked)).toBe(
      true
    );
    fireEvent.click(screen.getByRole("button", { name: "flights:bulk.stop" }));
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "flights:bulk.start" }));
    await waitFor(() =>
      expect(screen.getByTestId("flight-bulk-bar")).toHaveTextContent(
        'flights:bulk.selected {"count":0}'
      )
    );
  });
});
