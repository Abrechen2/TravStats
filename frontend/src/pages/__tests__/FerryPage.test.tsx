import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { rideFixture as busFixture } from "../../components/bus/__tests__/busFixture";
const rideFixture = (): FerryJourney => ({
  ...busFixture(),
  operator: "Adria Ferries",
  vesselName: "AF Mia",
  roadtripLegId: null,
  vehicleType: "motorhome",
  vehicleRegistration: null,
  vehicleLengthM: 7.4,
  vehicleHeightM: 3.1,
  vehicleWidthM: 2.3,
  passengerCount: 2,
  cabinType: "Cabin",
  ticketReference: null,
  distanceSource: "great_circle",
  geometrySource: "straight",
});
import type { FerryJourney } from "../../types/ferry";

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
vi.mock("../../components/ferry/FerryFormModal", () => ({
  FerryFormModal: ({ journey }: { journey: { id: string } | null }) => (
    <div data-testid="ferry-form">{journey ? journey.id : "new"}</div>
  ),
}));
vi.mock("../../components/Training/ConfirmModal", () => ({
  default: ({
    isOpen,
    message,
    onConfirm,
  }: {
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <div>
        <p data-testid="confirm-message">{message}</p>
        <button type="button" onClick={onConfirm}>
          confirm-delete
        </button>
      </div>
    ) : null,
}));
const documentCount = vi.hoisted(() => ({ value: null as number | null }));
vi.mock("../../hooks/useDocumentCount", () => ({ useDocumentCount: () => documentCount.value }));

const list = vi.fn();
const remove = vi.fn();
vi.mock("../../lib/api/ferry", () => ({
  ferryApi: {
    list: (...a: unknown[]) => list(...a),
    remove: (...a: unknown[]) => remove(...a),
  },
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import FerryPage from "../FerryPage";

const renderPage = (): void => {
  render(
    <MemoryRouter>
      <FerryPage />
    </MemoryRouter>
  );
};

const second: FerryJourney = {
  ...rideFixture(),
  id: "r2",
  operator: "Lux Express",
  vesselName: null,
  depStationName: "Tallinn Ferry Station",
  arrStationName: "Riga Ferry Station",
  status: "cancelled",
  distanceSource: "user",
  distanceKm: 310,
  departureTime: "2025-05-01T07:00:00.000Z",
  arrivalTime: null,
  times: undefined,
  depTimezone: "Europe/Tallinn",
  arrTimezone: "Europe/Riga",
};

const page = (...journeys: FerryJourney[]) => ({
  journeys,
  total: journeys.length,
  summary: { journeys: journeys.length, operators: 2, withoutOperator: 0, stations: 4 },
});

describe("FerryPage", () => {
  beforeEach(() => {
    list.mockReset();
    remove.mockReset();
    addToast.mockReset();
    navigate.mockReset();
    documentCount.value = null;
    localStorage.clear();
  });

  it("shows local times, sea distance provenance and server summary", async () => {
    list.mockResolvedValue(page(rideFixture(), second));
    renderPage();
    const row = await screen.findByTestId("ferry-row-r1");
    expect(row).toHaveTextContent("09:00");
    expect(row).toHaveTextContent("Luftlinie");
    expect(row).toHaveTextContent("Abgeschlossen");
    expect(
      screen.getByText("Überfahrten", { selector: "span.whitespace-nowrap" })
    ).toHaveTextContent("2 Überfahrten");
    expect(screen.getByText("Häfen")).toHaveTextContent("4 Häfen");
    expect(screen.getByTestId("ferry-row-r2")).toHaveTextContent("laut Ticket");
  });
  it("filters on the server and separates edit actions from opening a row", async () => {
    list.mockResolvedValue(page(rideFixture(), second));
    renderPage();
    const row = await screen.findByTestId("ferry-row-r1");
    fireEvent.click(within(row).getByRole("button", { name: "Überfahrt bearbeiten" }));
    expect(screen.getByTestId("ferry-form")).toHaveTextContent("r1");
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(navigate).toHaveBeenCalledWith("/ferry/r1");
    const option = await screen.findByRole("option", { name: "2025" });
    fireEvent.change(option.parentElement!, { target: { value: "2025" } });
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ year: 2025, offset: 0 }))
    );
  });
  it("retries a failed load instead of presenting an empty logbook", async () => {
    list.mockRejectedValue(new Error("offline"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Überfahrten konnten nicht geladen werden."
    );
    list.mockResolvedValue(page(rideFixture()));
    fireEvent.click(screen.getByRole("button", { name: /Erneut versuchen/ }));
    expect(await screen.findByTestId("ferry-row-r1")).toBeVisible();
  });
});
