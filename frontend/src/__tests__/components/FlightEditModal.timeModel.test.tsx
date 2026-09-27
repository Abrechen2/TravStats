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
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslation };
});
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
vi.mock("@/lib/api/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trips")>();
  return { ...actual, tripsApi: { ...actual.tripsApi, getAll: vi.fn().mockResolvedValue([]) } };
});

// Airports whose records carry NO zone by default — the case under test.
const airportMocks = vi.hoisted(() => ({
  getByCode: vi.fn(async (): Promise<{ timezone: string | null }> => ({ timezone: null })),
}));
vi.mock("../../lib/api/airports", () => ({ airportsApi: airportMocks }));

const flight: Flight = {
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

const lookupsDone = () =>
  waitFor(() => expect(airportMocks.getByCode).toHaveBeenCalledTimes(2)).then(() =>
    act(async () => {})
  );

/**
 * The edit modal under the time model (ADR 0002, D2): a time is submitted in
 * the airports' zones or not at all. It used to go out with the BROWSER's
 * zone whenever an airport lookup did not resolve, which froze the reader's
 * zone onto the flight.
 */
describe("FlightEditModal — time model", () => {
  beforeEach(() => {
    mocks.companionsList.mockReset().mockResolvedValue([]);
    airportMocks.getByCode.mockReset().mockResolvedValue({ timezone: null });
  });

  it("an edit that touches no time sends no time, so the stored zone stays", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={flight} isOpen onClose={vi.fn()} onSave={onSave} />);
    await lookupsDone();
    const notes = document.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "Fensterplatz" } });
    fireEvent.click(screen.getByText("Änderungen speichern"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.notes).toBe("Fensterplatz");
    expect(updates).not.toHaveProperty("departureLocal");
    expect(updates).not.toHaveProperty("depTimezone");
    expect(updates).not.toHaveProperty("arrTimezone");
  });

  it("a changed time without an airport zone is refused with the German reason, not sent in the browser's zone", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={flight} isOpen onClose={vi.fn()} onSave={onSave} />);
    await lookupsDone();
    const time = document.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.change(time, { target: { value: "07:15" } });
    fireEvent.click(screen.getByText("Änderungen speichern"));
    expect(await screen.findByText(/keine Zeitzone bekannt/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("sends the airports' zones once they resolved, and shows the gap refusal in German", async () => {
    airportMocks.getByCode.mockResolvedValue({ timezone: "Europe/Berlin" });
    const onSave = vi.fn().mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 422,
        data: { error: "does not exist in Europe/Berlin", code: "LOCAL_TIME_NONEXISTENT" },
      },
    });
    render(<FlightEditModal flight={flight} isOpen onClose={vi.fn()} onSave={onSave} />);
    await lookupsDone();
    fireEvent.click(screen.getByText("Änderungen speichern"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates).toMatchObject({
      departureLocal: "2026-06-01T12:00",
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Berlin",
    });
    expect(
      await screen.findByText(/Diese Uhrzeit gibt es an dem Tag dort nicht \(Zeitumstellung\)/)
    ).toBeInTheDocument();
  });
});
