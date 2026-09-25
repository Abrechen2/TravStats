/**
 * The edit modal offers the same suggestions from the user's logbook as the
 * create form, with one difference pinned here: it never WRITES the frequent
 * flyer number on its own. A modal opened to fix a seat would otherwise save a
 * number into a record the user was not looking at.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, fireEvent, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import FlightEditModal from "../../components/FlightEditModal";
import type { Flight } from "../../types";

const mocks = vi.hoisted(() => ({ companionsList: vi.fn(), suggestions: vi.fn() }));

vi.mock("@/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: mocks.suggestions,
}));
vi.mock("@/hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, string>) => (opts?.value ? `${k}:${opts.value}` : k),
    i18n: { language: "de" },
  }),
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
vi.mock("@/lib/api/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trips")>();
  return { ...actual, tripsApi: { ...actual.tripsApi, getAll: vi.fn().mockResolvedValue([]) } };
});

const mockFlight: Flight = {
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
};

// The trip and companion pickers load on mount; let them settle before
// asserting, or the act ratchet counts an intermediate render.
const renderModal = async (ui: ReactElement): Promise<void> => {
  await act(async () => {
    render(ui);
  });
};

const chip = (value: string): HTMLElement =>
  screen.getByRole("button", { name: `flights:form.suggestionChip:${value}` });

describe("FlightEditModal — entry suggestions", () => {
  beforeEach(() => {
    mocks.companionsList.mockReset().mockResolvedValue([]);
    mocks.suggestions.mockReset().mockReturnValue({
      seats: ["12A"],
      flightNumbers: ["LH2440"],
      frequentFlyerNumber: "992000111",
      departureTerminals: ["2"],
    });
  });

  it("asks only while open, with the flight's airline and route", async () => {
    await renderModal(
      <FlightEditModal
        flight={{ ...mockFlight, depIata: "FRA", arrIata: "MUC" }}
        isOpen={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(mocks.suggestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, airline: "LH", dep: "FRA", arr: "MUC" })
    );
  });

  it("offers the frequent flyer number as a chip instead of writing it", async () => {
    await renderModal(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(screen.queryByDisplayValue("992000111")).toBeNull();
    fireEvent.click(chip("992000111"));
    expect(screen.getByDisplayValue("992000111")).toBeTruthy();
  });

  it("fills seat, terminal and flight number from their chips", async () => {
    await renderModal(
      <FlightEditModal
        flight={{ ...mockFlight, flightNumber: "" }}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    fireEvent.click(chip("12A"));
    fireEvent.click(chip("2"));
    fireEvent.click(chip("LH2440"));
    expect(screen.getByDisplayValue("12A")).toBeTruthy();
    expect(screen.getByDisplayValue("2")).toBeTruthy();
    expect(screen.getByDisplayValue("LH2440")).toBeTruthy();
  });
});
