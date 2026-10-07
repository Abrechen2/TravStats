import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { rideFixture } from "../../components/bus/__tests__/busFixture";
import type { BusJourney } from "../../types/bus";

// The real German copy, so the test reads what the reader sees (a key that
// lost its interpolation would otherwise pass).
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
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
vi.mock("../../components/bus/BusFormModal", () => ({
  BusFormModal: ({ journey }: { journey: { id: string } | null }) => (
    <div data-testid="bus-form">{journey ? journey.id : "new"}</div>
  ),
}));
vi.mock("../../components/Training/ConfirmModal", () => ({
  default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? (
      <button type="button" onClick={onConfirm}>
        confirm-delete
      </button>
    ) : null,
}));

const list = vi.fn();
const remove = vi.fn();
vi.mock("../../lib/api/bus", () => ({
  busApi: {
    list: (...a: unknown[]) => list(...a),
    remove: (...a: unknown[]) => remove(...a),
  },
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import BusPage from "../BusPage";

const renderPage = (): void => {
  render(
    <MemoryRouter>
      <BusPage />
    </MemoryRouter>
  );
};

const second: BusJourney = {
  ...rideFixture(),
  id: "r2",
  operator: "Lux Express",
  lineName: null,
  depStationName: "Tallinn Bus Station",
  arrStationName: "Riga Bus Station",
  status: "cancelled",
  distanceSource: "user",
  distanceKm: 310,
  departureTime: "2025-05-01T07:00:00.000Z",
  arrivalTime: null,
  times: undefined,
  depTimezone: "Europe/Tallinn",
  arrTimezone: "Europe/Riga",
};

const page = (...journeys: BusJourney[]) => ({
  journeys,
  total: journeys.length,
  summary: { journeys: journeys.length, operators: 2, withoutOperator: 0, stations: 4 },
});

describe("BusPage", () => {
  beforeEach(() => {
    list.mockReset();
    remove.mockReset();
    addToast.mockReset();
    navigate.mockReset();
    localStorage.clear();
  });

  it("lists the rides with operator, route, terminal-clock times and status", async () => {
    list.mockResolvedValue(page(rideFixture(), second));
    renderPage();
    const row = await screen.findByTestId("bus-row-r1");
    expect(row.textContent).toContain("Kobus");
    expect(row.textContent).toContain("Seoul Express Bus Terminal → Sokcho Express Bus Terminal");
    // 00:00 UTC read in Seoul, never the viewer's zone.
    expect(row.textContent).toContain("09:00");
    expect(row.textContent).toContain("11:20");
    expect(row.textContent).toContain("2 h 20 min");
    expect(within(row).getByTestId("bus-status")).toHaveTextContent("Gefahren");
    // Only the measured chord says it is one; a typed figure stands bare.
    expect(row.textContent).toContain("Luftlinie");
    expect(screen.getByTestId("bus-row-r2").textContent).not.toContain("Luftlinie");
    expect(within(screen.getByTestId("bus-row-r2")).getByTestId("bus-status")).toHaveTextContent(
      "Storniert"
    );
  });

  it("counts the rides in the summary strip from the server's figures", async () => {
    list.mockResolvedValue(page(rideFixture(), second));
    renderPage();
    await screen.findByTestId("bus-row-r1");
    expect(screen.getByText("Fahrten")).toBeInTheDocument();
    expect(screen.getByText("Terminals")).toBeInTheDocument();
  });

  it("asks the server for one page, newest departure first", async () => {
    list.mockResolvedValue(page());
    renderPage();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(list.mock.calls[0][0]).toMatchObject({
      limit: 50,
      offset: 0,
      sort: "departure",
      order: "desc",
    });
  });

  it("says a failed load instead of drawing an empty logbook", async () => {
    list.mockRejectedValue(new Error("down"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Busfahrten konnten nicht geladen werden."
    );
    expect(screen.queryByTestId("bus-row-r1")).toBeNull();
    expect(screen.queryByText(/Noch keine Busfahrten/)).toBeNull();
  });

  it("offers the years the account rode in, newest first, from every page", async () => {
    list.mockResolvedValue(page(rideFixture(), second));
    renderPage();
    await screen.findByTestId("bus-row-r1");
    const yearSelect = await screen.findByRole("option", { name: "2025" });
    const options = within(yearSelect.parentElement as HTMLElement).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Alle Jahre", "2026", "2025"]);
  });

  it("names the add button in the empty state", async () => {
    list.mockResolvedValue(page());
    renderPage();
    expect(await screen.findByText(/Die erste Fahrt kommt über „Fahrt hinzufügen“/)).toBeVisible();
  });

  it("opens the form for a new ride from the add button", async () => {
    list.mockResolvedValue(page(rideFixture()));
    renderPage();
    await screen.findByTestId("bus-row-r1");
    fireEvent.click(screen.getByRole("button", { name: /Fahrt hinzufügen/ }));
    expect(screen.getByTestId("bus-form")).toHaveTextContent("new");
  });

  it("opens the ride's page on a row click, and the editor from the row's action", async () => {
    list.mockResolvedValue(page(rideFixture()));
    renderPage();
    const row = await screen.findByTestId("bus-row-r1");
    fireEvent.click(within(row).getByRole("button", { name: "Bearbeiten" }));
    expect(screen.getByTestId("bus-form")).toHaveTextContent("r1");
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(navigate).toHaveBeenCalledWith("/bus/r1");
  });

  it("deletes a ride after the confirmation and reloads the list", async () => {
    list.mockResolvedValue(page(rideFixture()));
    remove.mockResolvedValue(undefined);
    renderPage();
    const row = await screen.findByTestId("bus-row-r1");
    fireEvent.click(within(row).getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByText("confirm-delete"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "Busfahrt gelöscht"));
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(2));
  });

  it("keeps the ride and says so when the delete fails", async () => {
    list.mockResolvedValue(page(rideFixture()));
    remove.mockRejectedValue(new Error("nope"));
    renderPage();
    const row = await screen.findByTestId("bus-row-r1");
    fireEvent.click(within(row).getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByText("confirm-delete"));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "Die Busfahrt konnte nicht gelöscht werden.")
    );
    expect(screen.getByTestId("bus-row-r1")).toBeInTheDocument();
  });
});
