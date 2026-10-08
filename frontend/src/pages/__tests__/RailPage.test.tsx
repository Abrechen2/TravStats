import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number; minutes?: number }) =>
      opts?.count !== undefined
        ? `${k}/${opts.count}`
        : opts?.minutes !== undefined
          ? `${k}/${opts.minutes}`
          : k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
const addToast = vi.fn();
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }),
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/table/LogbookTabs", () => ({ default: () => null }));
vi.mock("../../components/rail/RailFormModal", () => ({
  RailFormModal: ({ journey }: { journey: { id: string } | null }) => (
    <div data-testid="rail-form">{journey ? journey.id : "new"}</div>
  ),
}));
// A new ride starts at the import chooser (ticket or by hand); its own tests
// live with the adapter. Here: that the page opens it, for rail.
vi.mock("../../components/import/DomainImportPanel", () => ({
  default: ({ open, adapter }: { open: boolean; adapter: { domain: string } }) =>
    open ? <div data-testid="rail-import-panel">{adapter.domain}</div> : null,
}));
vi.mock("../../components/import/adapters/railAdapter", () => ({
  useRailImportAdapter: () => ({ domain: "rail" }),
}));
vi.mock("../../components/Training/ConfirmModal", () => ({
  default: ({
    isOpen,
    onConfirm,
    message,
    confirmButtonClass,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    message: string;
    confirmButtonClass?: string;
  }) =>
    isOpen ? (
      <div>
        <p data-testid="delete-message">{message}</p>
        <button type="button" onClick={onConfirm} className={confirmButtonClass}>
          confirm-delete
        </button>
      </div>
    ) : null,
}));
// The delete question counts the ride's originals (forgejo#250).
const listForEntry = vi.fn();
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...a: unknown[]) => listForEntry(...a) },
}));

const list = vi.fn();
const listConnections = vi.fn();
const remove = vi.fn();
const stats = vi.fn();
vi.mock("../../lib/api/rail", () => ({
  railApi: {
    list: (...a: unknown[]) => list(...a),
    listConnections: (...a: unknown[]) => listConnections(...a),
    remove: (...a: unknown[]) => remove(...a),
    stats: (...a: unknown[]) => stats(...a),
  },
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

vi.mock("../../lib/api/loyalty", () => ({
  getLoyaltyMembership: vi.fn(async () => ({ programName: "BahnBonus" })),
}));

import { MemoryRouter } from "react-router-dom";

import RailPage from "../RailPage";
import type { RailJourney } from "../../types/rail";

// A row opens the journey's own page since the detail page (phase 2b); the
// loyalty notice reads the URL, so the page renders inside a router.
const renderPage = (): void => {
  render(
    <MemoryRouter>
      <RailPage />
    </MemoryRouter>
  );
};

/** A page of the connection list: each inner array is one ride's trains. */
const page = (
  ...rides: RailJourney[][]
): {
  connections: Array<{ id: string; legs: RailJourney[] }>;
  total: number;
  summary: { journeys: number; operators: number; withoutOperator: number; stations: number };
} => ({
  connections: rides.map((legs) => ({ id: legs[0].id, legs })),
  total: rides.length,
  // The server counts the whole filtered list; here that is the rides given.
  summary: { journeys: rides.flat().length, operators: 1, withoutOperator: 0, stations: 2 },
});

function journey(over: Partial<RailJourney> = {}): RailJourney {
  return {
    tightConnection: false,
    id: "j1",
    userId: "u1",
    operator: "DB Fernverkehr",
    trainCategory: "ICE",
    trainNumber: "9557",
    depStationName: "Frankfurt (Main) Hbf",
    depStationCode: null,
    depStationId: null,
    depLat: 50.1,
    depLon: 8.66,
    depCountry: "DE",
    depTimezone: "Europe/Berlin",
    arrStationName: "Paris Est",
    arrStationCode: null,
    arrStationId: null,
    arrLat: 48.88,
    arrLon: 2.36,
    arrCountry: "FR",
    arrTimezone: "Europe/Paris",
    departureTime: "2026-07-01T06:15:00.000Z",
    arrivalTime: "2026-07-01T10:09:00.000Z",
    distanceKm: 478.2,
    distanceSource: "great_circle",
    geometry: null,
    geometrySource: "straight",
    actualDepartureTime: null,
    actualArrivalTime: null,
    lookupProvider: null,
    lookupRef: null,
    travelClass: null,
    coach: null,
    seat: null,
    bookingReference: null,
    price: null,
    currency: "EUR",
    status: "completed",
    delayMinutes: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

describe("RailPage", () => {
  beforeEach(() => {
    list.mockReset();
    listConnections.mockReset();
    remove.mockReset();
    addToast.mockReset();
    navigate.mockReset();
    listForEntry.mockReset().mockResolvedValue([]);
    stats.mockReset().mockResolvedValue({ byYear: [{ year: 2025 }, { year: 2026 }] });
    localStorage.clear();
  });

  it("lists journeys with times on each station's own clock", async () => {
    listConnections.mockResolvedValue(page([journey()]));
    renderPage();
    const row = await screen.findByTestId("rail-row-j1");
    expect(row.textContent).toContain("Frankfurt (Main) Hbf → Paris Est");
    // 06:15 UTC read in Frankfurt, 10:09 UTC read in Paris — never the viewer's zone.
    expect(row.textContent).toContain("08:15");
    expect(row.textContent).toContain("12:09");
    expect(row.textContent).toContain("ICE 9557 · DB Fernverkehr");
    expect(row.textContent).toContain("rail:straightLine");
    // The bare "N journeys" line became the shared summary strip on
    // 2026-09-28, so the count is read off its first figure instead.
    // The label carries its count so one ride reads "1 Fahrt" (forgejo#160).
    expect(screen.getByText("rail:summary.journeys/1")).toBeInTheDocument();
  });

  it("asks the server for one page, not the whole logbook", async () => {
    listConnections.mockResolvedValue(page());
    renderPage();
    await waitFor(() => expect(listConnections).toHaveBeenCalled());
    expect(listConnections.mock.calls[0][0]).toMatchObject({ limit: 50, offset: 0 });
    // The grouped list is the logbook's; the leg list is the card view's.
    expect(list).not.toHaveBeenCalled();
  });

  it("says a failed load instead of drawing an empty logbook", async () => {
    listConnections.mockRejectedValue(new Error("down"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("rail:loadError");
    expect(screen.queryByText("rail:empty")).toBeNull();
  });

  // forgejo#191: the failure was a red paragraph with no way forward.
  it("offers a retry in the degraded state, and draws the rows once it succeeds", async () => {
    listConnections.mockRejectedValueOnce(
      Object.assign(new Error("down"), { response: { status: 503 } })
    );
    listConnections.mockResolvedValue(page([journey({ id: "back" })]));
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector('[data-empty-kind="degraded"]')).not.toBeNull();
    expect(alert).toHaveTextContent("HTTP 503");
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByTestId("rail-row-back")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("counts the whole filtered list in the strip, not the page on screen", async () => {
    listConnections.mockResolvedValue({
      ...page([journey()]),
      total: 300,
      summary: { journeys: 312, operators: 4, withoutOperator: 0, stations: 57 },
    });
    renderPage();
    expect(await screen.findByText("rail:summary.journeys/312")).toBeInTheDocument();
  });

  it("shows the empty state only for a logbook that loaded and is empty", async () => {
    listConnections.mockResolvedValue(page());
    renderPage();
    expect(await screen.findByText("rail:empty")).toBeInTheDocument();
  });

  it("keeps a recorded on-time arrival apart from an unrecorded delay", async () => {
    listConnections.mockResolvedValue(
      page([journey({ id: "a", delayMinutes: 0 })], [journey({ id: "b", delayMinutes: 12 })])
    );
    renderPage();
    expect((await screen.findByTestId("rail-row-a")).textContent).toContain("rail:onTime");
    expect(screen.getByTestId("rail-row-b").textContent).toContain("rail:delay/12");
  });

  it("opens the ticket-or-by-hand chooser for a new journey", async () => {
    listConnections.mockResolvedValue(page([journey()]));
    renderPage();
    await screen.findByTestId("rail-row-j1");
    expect(screen.queryByTestId("rail-import-panel")).toBeNull();
    fireEvent.click(screen.getByText("rail:add"));
    expect(screen.getByTestId("rail-import-panel")).toHaveTextContent("rail");
    expect(screen.queryByTestId("rail-form")).toBeNull();
  });

  // forgejo#250: the question names the ride, the originals that go with it
  // and what stays, behind the red button every delete uses.
  it("names what goes and what stays, behind the red delete button", async () => {
    listConnections.mockResolvedValue(
      page([journey({ bookingId: "b1", trip: { id: "t1", name: "Paris", color: "#fff" } })])
    );
    listForEntry.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
    renderPage();
    await screen.findByTestId("rail-row-j1");
    fireEvent.click(screen.getByRole("button", { name: "rail:delete" }));
    await waitFor(() =>
      expect(screen.getByTestId("delete-message").textContent).toContain(
        "documents:deleteCascadeNote/2"
      )
    );
    const message = screen.getByTestId("delete-message").textContent ?? "";
    expect(message).toContain("rail:deleteConfirmNamed");
    expect(message).toContain("common:delete.survivors");
    expect(listForEntry).toHaveBeenCalledWith({ type: "railJourney", id: "j1" });
    expect(screen.getByText("confirm-delete")).toHaveClass("bg-[var(--danger)]");
  });

  it("offers the add chooser as the next step of an empty logbook", async () => {
    listConnections.mockResolvedValue(page());
    renderPage();
    await screen.findByText("rail:empty");
    // The header's button reads "+ rail:add"; this one is the empty state's.
    fireEvent.click(screen.getByRole("button", { name: "rail:add" }));
    expect(screen.getByTestId("rail-import-panel")).toHaveTextContent("rail");
  });

  it("deletes after confirmation and reloads the list", async () => {
    listConnections.mockResolvedValueOnce(page([journey()]));
    listConnections.mockResolvedValueOnce(page());
    remove.mockResolvedValue(undefined);
    renderPage();
    await screen.findByTestId("rail-row-j1");
    fireEvent.click(screen.getByRole("button", { name: "rail:delete" }));
    fireEvent.click(screen.getByText("confirm-delete"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("j1"));
    expect(await screen.findByText("rail:empty")).toBeInTheDocument();
    expect(addToast).toHaveBeenCalledWith("success", "rail:deleted");
  });
});

// forgejo#187: a ride with changes of trains is ONE entry of the logbook.
describe("RailPage — a ride with changes", () => {
  const first = journey({
    id: "leg-1",
    depStationName: "Köln Hbf",
    arrStationName: "Frankfurt (Main) Hbf",
    arrTimezone: "Europe/Berlin",
    departureTime: "2026-07-01T05:00:00.000Z",
    arrivalTime: "2026-07-01T06:05:00.000Z",
    trainNumber: "101",
  });
  const second = journey({ id: "leg-2" });

  beforeEach(() => {
    list.mockReset();
    listConnections.mockReset();
    navigate.mockReset();
    stats.mockReset().mockResolvedValue({ byYear: [] });
    localStorage.clear();
  });

  it("draws one row: every station, first departure to last arrival, the trains", async () => {
    listConnections.mockResolvedValue(page([first, second]));
    renderPage();
    const row = await screen.findByTestId("rail-connection-row-leg-1");
    expect(row.textContent).toContain("Köln Hbf → Frankfurt (Main) Hbf → Paris Est");
    // 05:00 UTC read in Köln, 10:09 UTC read in Paris.
    expect(row.textContent).toContain("07:00");
    expect(row.textContent).toContain("12:09");
    expect(row.textContent).not.toContain("08:05");
    // 05:00 → 10:09 UTC, the wait included.
    expect(row.textContent).toContain("rail:detail.durationHm");
    expect(row.textContent).toContain("ICE 101 · ICE 9557");
    expect(row.textContent).toContain("rail:connection.changes/1");
    // The legs are not rows of their own …
    expect(screen.queryByTestId("rail-row-leg-1")).toBeNull();
    expect(screen.queryByTestId("rail-row-leg-2")).toBeNull();
    // … and the row leads to the connection's page, not to a single train —
    // which is also why it offers no edit or delete of its own.
    fireEvent.click(row);
    expect(navigate).toHaveBeenCalledWith("/rail/connection/leg-1");
    expect(row.querySelector("button")).toBeNull();
  });

  it("opens a direct ride's own page", async () => {
    listConnections.mockResolvedValue(page([journey({ id: "solo" })]));
    renderPage();
    fireEvent.click(await screen.findByTestId("rail-row-solo"));
    expect(navigate).toHaveBeenCalledWith("/rail/solo");
  });

  it("keeps counting trains in the summary strip, not rows", async () => {
    listConnections.mockResolvedValue(page([first, second], [journey({ id: "solo" })]));
    renderPage();
    await screen.findByTestId("rail-connection-row-leg-1");
    expect(screen.getByTestId("rail-row-solo")).toBeInTheDocument();
    expect(screen.getByText("rail:summary.journeys/3")).toBeInTheDocument();
  });

  it("states no status for a ride whose trains disagree", async () => {
    listConnections.mockResolvedValue(page([{ ...first, status: "cancelled" }, second]));
    renderPage();
    const row = await screen.findByTestId("rail-connection-row-leg-1");
    expect(row.querySelector('[data-testid="rail-status"]')).toBeNull();
  });

  it("pages over rides: the next page starts after the rides shown, not the trains", async () => {
    const first50 = Array.from({ length: 50 }, (_, i) => [journey({ id: `r${i}` })]);
    listConnections.mockResolvedValueOnce({
      ...page([first, second], ...first50.slice(1)),
      total: 60,
    });
    listConnections.mockResolvedValueOnce({ ...page([journey({ id: "solo" })]), total: 60 });
    renderPage();
    await screen.findByTestId("rail-connection-row-leg-1");
    fireEvent.click(screen.getAllByRole("button", { name: "common:table.pagination.next" })[0]);
    await screen.findByTestId("rail-row-solo");
    expect(listConnections.mock.calls[1][0]).toMatchObject({ limit: 50, offset: 50 });
  });
});

// Acceptance 2026-09-26: a rail card's figure had nowhere to lead. The list
// opens on the card's rides, in the linked year, and says so above them.
describe("RailPage — opened from a rail card's figure", () => {
  it("asks for the card's rides in that year and names both above the list", async () => {
    list.mockReset().mockResolvedValue({
      journeys: [journey()],
      total: 1,
      summary: { journeys: 1, operators: 1, withoutOperator: 0, stations: 2 },
    });
    listConnections.mockReset();
    stats.mockReset().mockResolvedValue({ byYear: [] });
    render(
      <MemoryRouter initialEntries={["/rail?membership=card-9&year=2025"]}>
        <RailPage />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ membershipId: "card-9", year: 2025 })
      )
    );
    // The card counted trains, so this view lists trains — never grouped.
    expect(listConnections).not.toHaveBeenCalled();
    const notice = await screen.findByTestId("loyalty-list-filter");
    await waitFor(() => expect(notice).toHaveTextContent("loyalty:listFilter.named"));
    expect(notice).toHaveTextContent("loyalty:listFilter.inYear");
  });
});

// forgejo#197: the shared logbook layout — the filter bar's status and year
// reach the server, and the year options are every year ridden.
describe("RailPage — filters", () => {
  beforeEach(() => {
    listConnections.mockReset().mockResolvedValue(page([journey()]));
    stats.mockReset().mockResolvedValue({ byYear: [{ year: 2024 }, { year: 2026 }] });
    localStorage.clear();
  });

  it("sends the chosen status and year to the server and offers every year ridden", async () => {
    renderPage();
    await screen.findByTestId("rail-row-j1");
    const year = screen.getByRole("combobox", { name: "rail:list.filterYear" });
    await waitFor(() =>
      expect(Array.from(year.querySelectorAll("option")).map((o) => o.value)).toEqual([
        "all",
        "2026",
        "2024",
      ])
    );
    fireEvent.change(year, { target: { value: "2024" } });
    fireEvent.change(screen.getByRole("combobox", { name: "rail:list.filterStatus" }), {
      target: { value: "cancelled" },
    });
    await waitFor(() =>
      expect(listConnections).toHaveBeenLastCalledWith(
        expect.objectContaining({ year: 2024, status: "cancelled", offset: 0 })
      )
    );
  });

  it("says a failed year lookup nowhere but the log — the list still loads", async () => {
    stats.mockReset().mockRejectedValue(new Error("down"));
    renderPage();
    expect(await screen.findByTestId("rail-row-j1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
