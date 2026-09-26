import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Flight } from "../../types";

/**
 * Silent-failure review 2026-09-26: a refused save showed axios's own
 * "Request failed with status code 400" in the edit dialog.
 */
const mocks = vi.hoisted(() => ({ getByCode: vi.fn() }));

vi.mock("@/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: () => ({
    seats: [],
    flightNumbers: [],
    frequentFlyerNumber: null,
    departureTerminals: [],
  }),
}));
vi.mock("@/hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ReceiptUpload", () => ({ default: () => null }));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({
    features: { enableCostTracking: false },
    display: { timezone: "Europe/Berlin", language: "de" },
  }),
}));
vi.mock("../../lib/api/airports", () => ({ airportsApi: { getByCode: mocks.getByCode } }));
vi.mock("../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn().mockResolvedValue([]) } }));
vi.mock("../../lib/api", () => ({ companionsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/lib/api/catalogue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/catalogue")>();
  return {
    ...actual,
    airlinesApi: {
      ...actual.airlinesApi,
      search: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    },
  };
});

import FlightEditModal from "../../components/FlightEditModal";

const FLIGHT: Flight = {
  id: "f1",
  userId: "u1",
  airline: "ANA",
  flightNumber: "NH203",
  depLat: 35.5,
  depLon: 139.8,
  arrLat: 40.6,
  arrLon: -73.8,
  departureTime: "2026-08-14T12:35:00.000Z",
  arrivalTime: "2026-08-14T16:50:00.000Z",
  depIata: "HND",
  arrIata: "JFK",
  status: "scheduled",
  createdAt: "2026-01-01T00:00:00.000Z",
  companions: [],
  tags: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getByCode.mockImplementation(async (code: string) =>
    code === "HND"
      ? { iata: "HND", timezone: "Asia/Tokyo", lat: 35.5, lon: 139.8 }
      : { iata: "JFK", timezone: "America/New_York", lat: 40.6, lon: -73.8 }
  );
});

describe("FlightEditModal — a refused save says so in the reader's language", () => {
  it("shows the rejection sentence, not axios's status text", async () => {
    const onSave = vi.fn().mockRejectedValue(
      Object.assign(new Error("Request failed with status code 400"), {
        response: { status: 400, data: { error: "Validation error", code: "VALIDATION_FAILED" } },
      })
    );
    render(<FlightEditModal flight={FLIGHT} isOpen onClose={() => {}} onSave={onSave} />);
    await waitFor(() =>
      expect((document.querySelector("#editDepartureDate") as HTMLInputElement).value).toBe(
        "2026-08-14"
      )
    );

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));

    expect(await screen.findByText("common:saveErrors.validation")).toBeInTheDocument();
    expect(screen.queryByText(/status code 400/)).toBeNull();
  });
});
