import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, act } from "@testing-library/react";
import FlightEditModal from "../../components/FlightEditModal";
import type { Flight } from "../../types";

const mocks = vi.hoisted(() => ({ companionsList: vi.fn() }));

// The flight forms ask the user's logbook for suggestions over the network;
// these tests pin other wiring and must reach none.
vi.mock("@/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: () => ({
    seats: [],
    flightNumbers: [],
    frequentFlyerNumber: null,
    departureTerminals: [],
  }),
}));
vi.mock("@/hooks/useTagSuggestions", () => ({
  useTagSuggestions: () => [{ name: "lounge", usageCount: 2 }],
}));
// The cost section's currency picker asks for the user's recent currencies on
// mount; an empty list is what a failed request would give it anyway.
vi.mock("@/hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ReceiptUpload", () => ({
  default: () => null,
}));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({
    features: { enableCostTracking: false },
  }),
}));
// `CatalogueCombobox` reaches for the airline catalogue on its own, from
// `lib/api/catalogue` — NOT through the `lib/api` barrel this file already
// mocks. Without this the field fired a real `GET /airlines?q=…` from jsdom,
// which resolved to nothing and left the combobox empty; the assertions below
// then passed against that emptiness rather than against a known catalogue
// (forgejo#110).
vi.mock("../../lib/api/catalogue", () => ({
  airlinesApi: {
    search: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    create: vi.fn(),
  },
  aircraftApi: {
    search: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    create: vi.fn(),
  },
}));

vi.mock("../../lib/api", () => ({
  companionsApi: { list: mocks.companionsList },
}));

// TripSelectField fetches the trip list on mount from `lib/api/trips` — a
// different module than the `lib/api` barrel, so a barrel mock never covered it
// and the request escaped to the network (forgejo#110). An empty list is what a
// failed request already produced, so the assertions below are unchanged.
const assignFlights = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trips")>();
  return {
    ...actual,
    tripsApi: {
      ...actual.tripsApi,
      getAll: vi.fn().mockResolvedValue([{ id: "t2", name: "Herbst" }]),
      assignFlights: (...a: unknown[]) => assignFlights(...a),
    },
  };
});

// The modal submits a time only in the AIRPORTS' zones (ADR 0002 D2), so a
// test that edits a time waits until both resolved. UTC keeps the wall clocks
// these tests type identical to the instants they assert.
const airportMocks = vi.hoisted(() => ({
  getByCode: vi.fn(async () => ({ timezone: "UTC" })),
}));
vi.mock("../../lib/api/airports", () => ({ airportsApi: airportMocks }));

async function airportsHydrated(): Promise<void> {
  await waitFor(() => expect(airportMocks.getByCode).toHaveBeenCalledTimes(2));
  await act(async () => {});
}

const mockFlight: Flight = {
  id: "1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH123",
  depIata: "FRA",
  arrIata: "MUC",
  depLat: 50.033,
  depLon: 8.571,
  arrLat: 48.354,
  arrLon: 11.786,
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T11:00:00.000Z",
  status: "flown",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const networkError = Object.assign(new Error("Network Error"), { isAxiosError: true });

function renderModal(over: Partial<React.ComponentProps<typeof FlightEditModal>> = {}) {
  const props = {
    flight: mockFlight,
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onAfterSave: vi.fn(),
    ...over,
  };
  render(<FlightEditModal {...props} />);
  return props;
}

const save = (): void => {
  fireEvent.click(screen.getByText("flights:edit.saveChanges"));
};

/** forgejo#245–#249 on the flight EDIT form — consistent with the create form. */
describe("FlightEditModal — the shared form blocks", () => {
  beforeEach(() => {
    mocks.companionsList.mockReset().mockResolvedValue([]);
    airportMocks.getByCode.mockClear();
    assignFlights.mockReset().mockResolvedValue(undefined);
  });

  it("marks the scheduled times required and explains the mark", async () => {
    renderModal();
    await airportsHydrated();
    expect(document.querySelector("#editDepartureTime")).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("common:form.requiredLegend")).toBeInTheDocument();
  });

  it("opens unchanged: Escape closes at once, even after the zones resolved", async () => {
    const props = renderModal();
    await airportsHydrated();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before a changed form is discarded, Cancel included", async () => {
    const props = renderModal();
    fireEvent.change(document.querySelector("#flight-edit-seat")!, { target: { value: "12A" } });
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.cancel" }));
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("keeps the draft after a dropped connection, says so, and the retry saves", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce(undefined);
    const props = renderModal({ onSave });
    fireEvent.change(document.querySelector("#flight-edit-seat")!, { target: { value: "12A" } });
    save();
    const banner = (await screen.findByText("common:saveErrors.network")).closest(
      "[data-form-error-banner]"
    ) as HTMLElement;
    expect(banner).toHaveAttribute("role", "alert");
    await waitFor(() => expect(document.activeElement).toBe(banner));
    expect((document.querySelector("#flight-edit-seat") as HTMLInputElement).value).toBe("12A");
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(props.onAfterSave).toHaveBeenCalledTimes(1);
  });

  it("saves once for a double click", async () => {
    let settle: () => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((r) => (settle = r)));
    renderModal({ onSave });
    act(() => {
      save();
      save();
    });
    await act(async () => settle());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("names a half-filled actual pair at its missing time and goes there", async () => {
    const onSave = vi.fn();
    renderModal({ onSave });
    fireEvent.change(document.querySelector("#editActualDepartureDate")!, {
      target: { value: "2026-06-01" },
    });
    save();
    const actualTime = document.querySelector("#editActualDepartureTime") as HTMLInputElement;
    await waitFor(() => expect(actualTime).toHaveAttribute("aria-invalid", "true"));
    await waitFor(() => expect(document.activeElement).toBe(actualTime));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses a negative price at its field and sends nothing", async () => {
    const onSave = vi.fn();
    renderModal({ onSave });
    const price = document.getElementById("flight-edit-cost-price") as HTMLInputElement;
    fireEvent.change(price, { target: { value: "-1" } });
    expect(price).toHaveAttribute("aria-invalid", "true");
    save();
    await waitFor(() => expect(document.activeElement).toBe(price));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("stays open and says so when the save went through but the trip move failed", async () => {
    assignFlights.mockRejectedValueOnce(networkError).mockResolvedValueOnce(undefined);
    const props = renderModal();
    await waitFor(() => expect(document.querySelector('option[value="t2"]')).not.toBeNull());
    const tripSelect = document.querySelector('option[value="t2"]')!.closest("select")!;
    fireEvent.change(tripSelect, { target: { value: "t2" } });
    save();
    expect(await screen.findByText("flights:edit.savedTripAssignFailed")).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    // The caller reloads only when the dialog closes (review I1).
    expect(props.onAfterSave).not.toHaveBeenCalled();
    expect(props.onSave).toHaveBeenCalledTimes(1);
    // The retry moves the trip only — the flight is not saved a second time.
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(assignFlights).toHaveBeenCalledTimes(2);
  });

  it("keeps Save disabled while the trip move after the save runs (review I1)", async () => {
    let settle: () => void = () => {};
    assignFlights.mockImplementationOnce(() => new Promise<void>((r) => (settle = r)));
    const props = renderModal();
    await waitFor(() => expect(document.querySelector('option[value="t2"]')).not.toBeNull());
    const tripSelect = document.querySelector('option[value="t2"]')!.closest("select")!;
    fireEvent.change(tripSelect, { target: { value: "t2" } });
    save();
    await waitFor(() => expect(assignFlights).toHaveBeenCalledTimes(1));
    const busy = screen.getByRole("button", { name: /common:buttons\.saving/ });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    await act(async () => settle());
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(assignFlights).toHaveBeenCalledTimes(1);
    expect(props.onAfterSave).toHaveBeenCalledTimes(1);
  });

  it("names its fields by their visible labels", async () => {
    renderModal();
    await airportsHydrated();
    expect(screen.getByLabelText("flights:form.seat")).toHaveAttribute("id", "flight-edit-seat");
    expect(screen.getByLabelText("flights:form.airline")).toHaveAttribute(
      "id",
      "flight-edit-airline"
    );
    expect(screen.getByLabelText("flights:form.from")).toHaveAttribute(
      "id",
      "flight-edit-departure-airport"
    );
  });
});
