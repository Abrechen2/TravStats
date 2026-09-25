import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Trip } from "../../types";

/**
 * The logistics tab hands the trip's flights to the booking editor, so a PNR
 * already recorded on a flight is offered on the booking that paid for it.
 * The editor's own suite pins the chips; this pins the wiring.
 */
const getByIdMock = vi.fn();

// The page renders the summary card, which asks the instance whether it has a
// text model at all (`GET /parser-capabilities`). The network guard fails any
// test that lets that request out (forgejo#110).
vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));

// The documents section fetches its entry's kept originals on mount. It has
// its own suite, and `__tests__/documentsMountPoints.test.tsx` checks that
// this surface mounts it — here it would only be a request reaching the
// network, which the setup refuses (forgejo#110).
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));

vi.mock("../../lib/api", () => ({
  tripsApi: {
    getById: (...args: unknown[]) => getByIdMock(...args),
  },
}));

vi.mock("../../lib/api/places", () => ({
  listPlaces: vi.fn().mockResolvedValue([]),
}));

// The booking editor's currency picker asks for the user's recent currencies.
vi.mock("../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "de" },
  }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

import TripDetailPage from "../TripDetailPage";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    userId: "user-1",
    name: "Kostenprobe",
    description: null,
    color: "#818cf8",
    createdAt: "2024-05-01T00:00:00.000Z",
    updatedAt: "2024-05-01T00:00:00.000Z",
    startDate: "2024-05-13T00:00:00.000Z",
    endDate: "2024-05-15T00:00:00.000Z",
    status: "completed",
    category: null,
    tags: [],
    companions: [],
    notes: null,
    summary: null,
    originLabel: null,
    destinationLabel: null,
    coverImageUrl: null,
    icon: null,
    countries: [],
    flights: [],
    cruises: [],
    stops: [],
    journalEntries: [],
    photos: [],
    lodgingStays: [],
    bookings: [],
    ...overrides,
  };
}

async function renderTripDetail(trip: Trip): Promise<void> {
  getByIdMock.mockResolvedValue(trip);
  render(
    <MemoryRouter initialEntries={[`/trips/${trip.id}`]}>
      <Routes>
        <Route path="/trips/:id" element={<TripDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
  await screen.findByText(trip.name);
}

describe("TripDetailPage booking editor", () => {
  it("offers the booking reference of the trip's flight as the booking's PNR", async () => {
    await renderTripDetail(
      makeTrip({
        bookings: [
          { id: "b1", pnr: null, price: 100, currency: "EUR" },
        ] as unknown as Trip["bookings"],
        flights: [
          {
            id: "f1",
            depIata: "MUC",
            arrIata: "CPH",
            departureTime: "2024-05-13T08:00:00.000Z",
            bookingId: "b1",
            bookingReference: "XYZ123",
          },
        ] as unknown as Trip["flights"],
      })
    );
    await userEvent.click(screen.getByText("trips:detail.tabs.logistics"));
    await userEvent.click(screen.getByRole("button", { name: "trips:bookingEdit.title" }));

    expect(await screen.findByText("XYZ123")).toBeInTheDocument();
  });
});
