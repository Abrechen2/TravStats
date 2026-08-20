import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Trip } from "../../types";

// Feature gap this pins: a LodgingStay linked to a trip previously never
// surfaced on the trip page. It must now render as a check-in AND a
// check-out entry on the timeline (mirroring how TripStop entries work),
// and clicking either must link to the hotel's own detail page.

const getByIdMock = vi.fn();

vi.mock("../../lib/api", () => ({
  tripsApi: {
    getById: (...args: unknown[]) => getByIdMock(...args),
  },
}));

// The global settingsStore mock (src/__tests__/setup.ts) has no
// `enabledDomains`, which the real useEnabledDomains hook needs — stub the
// hook directly so every domain reads as enabled for this test.
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

import TripDetailPage from "../TripDetailPage";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    userId: "user-1",
    name: "Zürich Trip",
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
    </MemoryRouter>,
  );
  await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
  // Wait for the loading placeholder to clear before switching tabs.
  await screen.findByText(trip.name);
}

describe("TripDetailPage — linked lodging stays on the timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a check-in AND a check-out entry, each linking to the hotel", async () => {
    const trip = makeTrip({
      lodgingStays: [
        {
          id: "stay-1",
          lodgingId: "lodging-1",
          userId: "user-1",
          tripId: "trip-1",
          bookingId: null,
        checkInTime: null,
        checkOutTime: null,
          checkIn: "2024-05-13T15:00:00.000Z",
          checkOut: "2024-05-15T11:00:00.000Z",
          datePrecision: "DAY" as const,
          nights: null,
          status: "completed",
          roomNumber: null,
          roomCategory: null,
          board: null,
          pricePerNight: null,
          currency: "EUR",
          totalPrice: null,
          totalPriceBase: null,
          fxRate: null,
          fxRateDate: null,
          fxBaseCurrency: null,
          fxSource: null,
          isAwardStay: false,
          ratingRoom: null,
          ratingBreakfast: null,
          ratingService: null,
          ratingOverall: null,
          roomAmenities: [],
          bookingReference: null,
          membershipId: null,
          membershipOptOut: false,
          receiptUrl: null,
          guests: null,
          companions: [],
          notes: null,
          parserTemplate: null,
          parserConfidence: null,
          dataSource: null,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
          lodging: {
            id: "lodging-1",
            userId: "user-1",
            type: "hotel",
            name: "Grand Hotel Zürich",
            chainId: null,
            chain: null,
            address: null,
            city: "Zürich",
            country: "CH",
            isoCountryCode: null,
            lat: null,
            lon: null,
            stars: null,
            amenities: [],
            visited: true,
            notes: null,
            dataSource: null,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            stays: [],
            overallRating: null,
            stayCount: 1,
            nights: 2,
            totalSpendBase: 0,
            totalSpendBaseByCurrency: {},
          },
        },
      ],
    });
    await renderTripDetail(trip);

    // Switch to the Timeline tab (default tab is Overview).
    await userEvent.click(screen.getByText("trips:detail.tabs.timeline"));

    const checkInLink = await screen.findByRole("link", {
      name: /trips:detail.timeline.lodgingCheckIn/,
    });
    const checkOutLink = screen.getByRole("link", {
      name: /trips:detail.timeline.lodgingCheckOut/,
    });
    expect(checkInLink).toHaveAttribute("href", "/lodging/lodging-1");
    expect(checkOutLink).toHaveAttribute("href", "/lodging/lodging-1");
  });

  it("renders no lodging entry when the trip has no linked stays", async () => {
    const trip = makeTrip({ lodgingStays: [] });
    await renderTripDetail(trip);

    await userEvent.click(screen.getByText("trips:detail.tabs.timeline"));

    expect(
      screen.queryByRole("link", { name: /trips:detail.timeline.lodgingCheckIn/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("trips:detail.timeline.noEvents")).toBeInTheDocument();
  });
});
