import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Trip } from "../../types";

/**
 * forgejo#86 — the trip page's total-cost tile wrote `${currency}
 * ${Math.round(total)}` ("EUR 40206") while the trip CARD for the same trip
 * wrote "40.206 €" through `formatCurrency`. Mirrors
 * `components/Trips/__tests__/TripCard.costTile.test.tsx`, which pins the
 * card; this pins the page to the same formatter.
 */
const getByIdMock = vi.fn();

vi.mock("../../lib/api", () => ({
  tripsApi: {
    getById: (...args: unknown[]) => getByIdMock(...args),
  },
}));

vi.mock("../../lib/api/places", () => ({
  listPlaces: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));

// The tile must follow the UI language: "40.206 €" in German is exactly the
// spelling the old string interpolation could never produce.
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

const priced = makeTrip({
  bookings: [
    { id: "b1", pnr: "AB12CD", price: 40206, currency: "EUR" },
  ] as unknown as Trip["bookings"],
});

describe("TripDetailPage cost tile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the total-cost tile as '40.206 €' in German, never 'EUR 40206'", async () => {
    await renderTripDetail(priced);

    expect(screen.getByText(/40\.206\s€/)).toBeInTheDocument();
    expect(screen.queryByText(/EUR 40206/)).not.toBeInTheDocument();
  });

  it("writes the bookings table through the same formatter, and never invents EUR", async () => {
    await renderTripDetail(
      makeTrip({
        bookings: [
          { id: "b1", pnr: "AB12CD", price: 40206, currency: "EUR" },
          { id: "b2", pnr: "ZZ99YY", price: 150.5, currency: null },
        ] as unknown as Trip["bookings"],
      })
    );
    await userEvent.click(screen.getByText("trips:detail.tabs.logistics"));

    const row = (await screen.findByText("ZZ99YY")).closest("tr");
    // A booking with no currency is a bare localised number — abstention,
    // not the "EUR 150.50" the old `?? "EUR"` default wrote.
    expect(row?.textContent).toMatch(/150,5/);
    expect(row?.textContent).not.toMatch(/EUR|€/);

    const euroRow = screen.getByText("AB12CD").closest("tr");
    expect(euroRow?.textContent).toMatch(/40\.206\s€/);
    expect(euroRow?.textContent).not.toContain("EUR 40206.00");
  });
});
