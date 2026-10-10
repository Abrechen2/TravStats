import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import FlightEditModal from "../../components/FlightEditModal";
import type { Flight } from "../../types";

/**
 * forgejo#285: when online check-in opens is edited in the flight dialog —
 * sent as the departure airport's wall clock, and a change to it alone is a
 * change the dialog asks about before it is discarded.
 *
 * The mocks are the ones the SRV-UI-001 suite uses.
 */

const mocks = vi.hoisted(() => ({ companionsList: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ReceiptUpload", () => ({ default: () => null }));
// The form's own-logbook offers and the recent-currency chips ask the server;
// neither is what this test is about.
vi.mock("@/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: () => ({
    seats: [],
    flightNumbers: [],
    frequentFlyerNumber: null,
    departureTerminals: [],
  }),
}));
vi.mock("@/hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({ features: { enableCostTracking: true } }),
}));
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
vi.mock("../../lib/api", () => ({ companionsApi: { list: mocks.companionsList } }));
vi.mock("@/lib/api/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trips")>();
  return { ...actual, tripsApi: { ...actual.tripsApi, getAll: vi.fn().mockResolvedValue([]) } };
});

const freeFlight: Flight = {
  id: "1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH123",
  depLat: 50.033,
  depLon: 8.571,
  arrLat: 48.354,
  arrLon: 11.786,
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T11:00:00.000Z",
  status: "flown",
  createdAt: "2026-01-01T00:00:00.000Z",
  price: 0,
  currency: "EUR",
  taxes: 0,
  fees: 0,
};

function checkInInputs(): { day: HTMLInputElement; time: HTMLInputElement } {
  const day = document.querySelector<HTMLInputElement>('input[type="date"][id$="-day"]')!;
  const time = document.querySelector<HTMLInputElement>('input[type="time"][id$="-time"]')!;
  return { day, time };
}

describe("FlightEditModal — online check-in opens (forgejo#285)", () => {
  beforeEach(() => {
    mocks.companionsList.mockReset().mockResolvedValue([]);
  });

  it("sends the opening as the departure airport's wall clock, nothing else new", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(
      <FlightEditModal flight={freeFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );
    const { day, time } = checkInInputs();
    fireEvent.change(day, { target: { value: "2026-05-31" } });
    fireEvent.change(time, { target: { value: "10:00" } });
    fireEvent.click(getByText("flights:edit.saveChanges"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.onlineCheckInOpensAt).toEqual({ local: "2026-05-31T10:00" });
  });

  it("asks before discarding a changed check-in opening", async () => {
    const onClose = vi.fn();
    const { findByText, getByRole } = render(
      <FlightEditModal flight={freeFlight} isOpen={true} onClose={onClose} onSave={vi.fn()} />
    );
    fireEvent.change(checkInInputs().day, { target: { value: "2026-05-31" } });
    fireEvent.click(getByRole("button", { name: "common:buttons.cancel" }));
    expect(await findByText("common:discard.title")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
