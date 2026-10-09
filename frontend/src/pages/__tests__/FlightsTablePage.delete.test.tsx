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
vi.mock("../../components/FlightRowActions", () => ({
  default: ({ flight, onDelete }: { flight: { id: string }; onDelete: (id: string) => void }) => (
    <button type="button" onClick={() => onDelete(flight.id)}>{`delete-${flight.id}`}</button>
  ),
}));
vi.mock("../../components/table/ColumnPicker", () => ({ ColumnPicker: () => null }));

const deleteFlight = vi.fn();
const getTrack = vi.fn();
const listForEntry = vi.fn();
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...a: unknown[]) => listForEntry(...a) },
}));
const getAll = vi.fn();
const getFacets = vi.fn();
const tripsGetAll = vi.fn();
vi.mock("../../lib/api", () => ({
  flightsApi: {
    getAll: (...a: unknown[]) => getAll(...a),
    getFacets: (...a: unknown[]) => getFacets(...a),
    create: vi.fn(),
    update: vi.fn(),
    delete: (...a: unknown[]) => deleteFlight(...a),
    getTrack: (...a: unknown[]) => getTrack(...a),
  },
  tripsApi: { getAll: (...a: unknown[]) => tripsGetAll(...a) },
}));

import FlightsTablePage from "../FlightsTablePage";

const FLIGHTS = [
  {
    id: "f1",
    status: "flown",
    flightNumber: "LH1",
    depIata: "MUC",
    arrIata: "CPH",
    tripId: "t1",
    bookingId: "b1",
    bookingReference: "ABC123",
  },
];

/** forgejo#250 — the list's delete names what goes and what stays, in red. */
describe("FlightsTablePage delete", () => {
  beforeEach(() => {
    urlParams.current = "";
    getAll.mockReset().mockResolvedValue({ flights: FLIGHTS, total: 1, limit: 25, offset: 0 });
    getFacets.mockReset().mockResolvedValue({
      years: [],
      airlines: [],
      summary: { flights: 1, airlines: 0, airports: 2, withoutAirline: 1 },
    });
    tripsGetAll.mockReset().mockResolvedValue([{ id: "t1", name: "Herbst" }]);
    listForEntry.mockReset().mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
    deleteFlight.mockReset().mockResolvedValue(undefined);
    getTrack.mockReset().mockResolvedValue({ id: "tr1", pointCount: 1234 });
  });

  it("counts the documents and names the trip and booking that stay", async () => {
    render(<FlightsTablePage />);
    fireEvent.click(await screen.findByText("delete-f1"));
    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() =>
      expect(dialog).toHaveTextContent('documents:deleteCascadeNote {"count":2}')
    );
    expect(listForEntry).toHaveBeenCalledWith({ type: "flight", id: "f1" });
    // The phone's recording goes too (review M8).
    await waitFor(() =>
      expect(dialog).toHaveTextContent('flights:deleteParts.recording {"count":1234}')
    );
    expect(dialog).toHaveTextContent('flights:deleteSurvivors.trip {\\"name\\":\\"Herbst\\"}');
    expect(dialog).toHaveTextContent(
      'flights:deleteSurvivors.bookingMaybe {\\"pnr\\":\\"ABC123\\"}'
    );
    const confirm = screen.getByRole("button", { name: "flights:table.deleteConfirm.confirm" });
    expect(confirm.className).toContain("bg-[var(--danger)]");
  });

  it("asks for no count until a delete is asked about, and deletes once", async () => {
    render(<FlightsTablePage />);
    await screen.findByText("delete-f1");
    expect(listForEntry).not.toHaveBeenCalled();
    expect(getTrack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("delete-f1"));
    const confirm = await screen.findByRole("button", {
      name: "flights:table.deleteConfirm.confirm",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteFlight).toHaveBeenCalledTimes(1));
  });
});
