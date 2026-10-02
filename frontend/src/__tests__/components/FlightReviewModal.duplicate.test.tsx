import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

// Both airports resolve with their zone, so the save reaches `onConfirm`.
vi.mock("../../lib/api/airports", () => ({
  airportsApi: {
    getByCode: vi.fn(async (code: string) => ({
      iata: code,
      icao: `E${code}`,
      name: code,
      lat: 48,
      lon: 11,
      timezone: "Europe/Berlin",
    })),
  },
}));
vi.mock("../../lib/api", () => ({
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
  parseApi: { submitParserCorrection: vi.fn() },
}));
vi.mock("../../components/AirportAutocomplete", () => ({ default: () => null }));
vi.mock("../../store/authStore", () => ({
  useAuthStore: () => ({ user: { id: "u1" } }),
}));
vi.mock("../../store/settingsStore", () => {
  const state = { features: { enableCostTracking: false }, baseCurrency: "EUR" };
  return {
    useSettingsStore: Object.assign(() => state, { getState: () => state }),
  };
});
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});
vi.mock("@/lib/api/suggestions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/suggestions")>();
  return {
    ...actual,
    suggestionsApi: {
      ...actual.suggestionsApi,
      aircraft: vi.fn().mockResolvedValue([]),
      airlines: vi.fn().mockResolvedValue([]),
    },
  };
});

const booking = {
  flightNumber: "LH2230",
  departureCode: "MUC",
  arrivalCode: "CDG",
  departureTime: "2025-07-10T10:00:00",
  arrivalTime: "2025-07-10T11:35:00",
} as unknown as ParsedBooking;

/** The server's answer to a flight the user already has (POST /flights). */
const duplicate409 = {
  isAxiosError: true,
  response: {
    status: 409,
    data: {
      error: "DUPLICATE_FLIGHT",
      message: "Flight LH2230 on this day already exists",
      existingFlight: {
        id: "flight-1",
        flightNumber: "LH2230",
        airline: "Lufthansa",
        depIata: "MUC",
        arrIata: "CDG",
        departureTime: "2025-07-10T08:00:00.000Z",
      },
    },
  },
};

async function submitReview(onConfirm: () => Promise<void>, onClose = vi.fn()) {
  render(
    <FlightReviewModal
      isOpen
      onClose={onClose}
      onConfirm={onConfirm}
      initialData={booking}
      source="email"
    />
  );
  await waitFor(() => expect(document.querySelector("form")).toBeTruthy());
  await act(() => new Promise((r) => setTimeout(r, 50)));
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
  return onClose;
}

/**
 * forgejo#159: reading the same confirmation twice answered the second
 * "Bestätigen" with "Flug konnte nicht gespeichert werden. Bitte überprüfe
 * deine Eingaben." — the server had said 409 DUPLICATE_FLIGHT, but the review
 * read every failure through the generic save rule. The inputs were right; the
 * flight simply exists, and the reader is told so, with a way out.
 */
describe("FlightReviewModal — a flight the user already has", () => {
  it("names the duplicate instead of asking to check the inputs", async () => {
    const onConfirm = vi.fn().mockRejectedValue(duplicate409);
    await submitReview(onConfirm);

    expect(await screen.findByText(/LH2230 \(MUC → CDG\) ist bereits/)).toBeInTheDocument();
    expect(screen.queryByText(/Bitte überprüfe deine Eingaben/)).not.toBeInTheDocument();
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
  });

  it("offers to open the existing flight and to cancel the import", async () => {
    const onConfirm = vi.fn().mockRejectedValue(duplicate409);
    const onClose = await submitReview(onConfirm);

    const open = await screen.findByRole("link", { name: "Vorhandenen Flug öffnen" });
    expect(open).toHaveAttribute("href", "/flights/flight-1");

    fireEvent.click(screen.getByRole("button", { name: "Import abbrechen" }));
    expect(onClose).toHaveBeenCalled();
  });
});
