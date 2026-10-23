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

// The page renders the summary card, which asks the instance whether it has a
// text model at all (`GET /parser-capabilities`). The network guard fails any
// test that lets that request out (forgejo#110).
// Shared trips (2026-10-09): the trip overview, the settings and the inbox
// read the sharing API on mount; answered empty so no request escapes.
vi.mock("@/lib/api/sharing", () => ({
  sharingApi: {
    tripSharing: vi.fn().mockResolvedValue({
      groupId: null,
      people: [],
      linkableUsers: [],
      bookingTotals: [],
    }),
    listConsents: vi.fn().mockResolvedValue({ incoming: [], outgoing: [] }),
    listCompanions: vi.fn().mockResolvedValue({ companions: [], linkableUsers: [] }),
    listNotices: vi.fn().mockResolvedValue([]),
    inboxCount: vi.fn().mockResolvedValue(0),
  },
}));

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

// The global settingsStore mock (src/__tests__/setup.ts) has no
// `enabledDomains`, which the real useEnabledDomains hook needs — stub the
// hook directly so every domain reads as enabled for this test.
// Places left the beta gate with the 2.7 line, so the trip timeline now asks
// for the trip's place visits unconditionally. Unmocked that went out as a
// real request, which the suite's network guard fails rather than prints
// (forgejo#110).
// Notes on the trip's days (forgejo#146) have their own suite
// (`tripNotesTimeline.test.tsx`); answered empty so no request escapes.
vi.mock("../../hooks/useTripNotes", () => ({
  useTripNotes: () => ({ notes: null, failed: false, reload: () => {} }),
}));

vi.mock("../../lib/api/places", () => ({
  listPlaces: () => Promise.resolve([]),
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

// The overview's roadtrip list has its own endpoint and its own test.
vi.mock("../../components/Roadtrips/useTripRoadtrips", () => ({ useTripRoadtrips: () => [] }));

import TripDetailPage from "../TripDetailPage";
import { findNamed, getNamed, queryNamed } from "../../__tests__/helpers/namedElement";

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

const STAY: NonNullable<Trip["lodgingStays"]>[number] = {
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
};

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
  // Wait for the loading placeholder to clear before switching tabs.
  await screen.findByText(trip.name);
}

describe("TripDetailPage — linked lodging stays on the timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a check-in AND a check-out entry, each linking to the hotel", async () => {
    const trip = makeTrip({
      lodgingStays: [STAY],
    });
    await renderTripDetail(trip);

    // Switch to the Timeline tab (default tab is Overview).
    await userEvent.click(screen.getByText("trips:detail.tabs.timeline"));

    const checkInLink = await findNamed("link", /trips:detail.timeline.lodgingCheckIn/);
    const checkOutLink = getNamed("link", /trips:detail.timeline.lodgingCheckOut/);
    expect(checkInLink).toHaveAttribute("href", "/lodging/lodging-1");
    expect(checkOutLink).toHaveAttribute("href", "/lodging/lodging-1");
  });

  it("shows the stay's deadlines on its check-in entry only (forgejo#285)", async () => {
    const trip = makeTrip({
      lodgingStays: [
        {
          ...STAY,
          times: {
            freeCancellationOn: { date: "2024-05-10", zone: "Europe/Zurich", precision: "day" },
            paymentDue: { date: "2024-05-01", zone: null, precision: "day" },
          },
        },
      ],
    });
    await renderTripDetail(trip);
    await userEvent.click(screen.getByText("trips:detail.tabs.timeline"));
    const checkIn = await findNamed("link", /trips:detail.timeline.lodgingCheckIn/);
    expect(checkIn).toHaveTextContent("common:deadlines.freeCancellation");
    expect(checkIn).toHaveTextContent("common:deadlines.paymentDue");
    const checkOut = getNamed("link", /trips:detail.timeline.lodgingCheckOut/);
    expect(checkOut).not.toHaveTextContent("common:deadlines.freeCancellation");
  });

  it("renders no lodging entry when the trip has no linked stays", async () => {
    const trip = makeTrip({ lodgingStays: [] });
    await renderTripDetail(trip);

    await userEvent.click(screen.getByText("trips:detail.tabs.timeline"));

    expect(queryNamed("link", /trips:detail.timeline.lodgingCheckIn/)).not.toBeInTheDocument();
    expect(screen.getByText("trips:detail.timeline.noEvents")).toBeInTheDocument();
  });
});

// beta.22 UAT: "Weit von den Reisezielen entfernt" compared a hotel with the
// trip's flight arrivals only — the Oslo hotel of a trip that flew to
// Frankfurt and took the night ferry Kiel–Oslo was flagged as a likely typo.
describe("TripDetailPage — the far-from-destinations hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const FLIGHT = {
    id: "f1",
    depIata: "ZRH",
    arrIata: "FRA",
    depLat: 47.46,
    depLon: 8.55,
    arrLat: 50.03,
    arrLon: 8.57,
    departureTime: "2024-05-12T08:00:00.000Z",
    arrivalTime: "2024-05-12T09:00:00.000Z",
    status: "flown",
  } as unknown as NonNullable<Trip["flights"]>[number];

  const FERRY = {
    id: "fe1",
    operator: "Color Line",
    vesselName: null,
    depStationName: "Kiel Norwegenkai",
    arrStationName: "Oslo Hjortneskaia",
    depLat: 54.33,
    depLon: 10.14,
    arrLat: 59.9,
    arrLon: 10.72,
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Oslo",
    departureTime: "2024-05-12T12:00:00.000Z",
    arrivalTime: "2024-05-13T08:00:00.000Z",
    status: "completed",
    price: null,
    currency: null,
  } as unknown as NonNullable<Trip["ferryJourneys"]>[number];

  const at = (lat: number, lon: number, name: string): typeof STAY => ({
    ...STAY,
    lodging: { ...STAY.lodging, name, lat, lon },
  });

  async function checkInText(trip: Trip): Promise<string> {
    await renderTripDetail(trip);
    await userEvent.click(screen.getByText("trips:detail.tabs.timeline"));
    const checkIn = await findNamed("link", /trips:detail.timeline.lodgingCheckIn/);
    return checkIn.textContent ?? "";
  }

  it("does not flag a hotel the trip reached by ferry", async () => {
    const text = await checkInText(
      makeTrip({
        flights: [FLIGHT],
        ferryJourneys: [FERRY],
        lodgingStays: [at(59.91, 10.75, "Oslo")],
      })
    );
    expect(text).not.toContain("trips:detail.timeline.lodgingFarFromTrip");
  });

  it("still flags a hotel far from every place the trip reached", async () => {
    const text = await checkInText(
      makeTrip({
        flights: [FLIGHT],
        ferryJourneys: [FERRY],
        lodgingStays: [at(-33.87, 151.21, "Sydney")],
      })
    );
    expect(text).toContain("trips:detail.timeline.lodgingFarFromTrip");
  });

  it("says nothing when a leg of the trip has no known place to compare with", async () => {
    // A train ride from an older server carries no station coordinates: the
    // hotel may well be at its end, so the evidence is too thin to warn.
    const text = await checkInText(
      makeTrip({
        flights: [FLIGHT],
        railJourneys: [
          {
            id: "j1",
            operator: null,
            trainCategory: "ICE",
            trainNumber: "1",
            depStationName: "Frankfurt Hbf",
            arrStationName: "Somewhere",
            depTimezone: "Europe/Berlin",
            arrTimezone: "Europe/Berlin",
            departureTime: "2024-05-12T10:00:00.000Z",
            arrivalTime: "2024-05-12T14:00:00.000Z",
            distanceKm: null,
            distanceSource: null,
            status: "completed",
            transitMode: "rail",
            delayMinutes: null,
            price: null,
            currency: null,
            bookingId: null,
          },
        ],
        lodgingStays: [at(-33.87, 151.21, "Sydney")],
      })
    );
    expect(text).not.toContain("trips:detail.timeline.lodgingFarFromTrip");
  });
});

// The trip summary loads its plan independently of the timeline feature under test.
vi.mock("../../lib/api/travplan", () => ({
  travplanApi: { get: vi.fn().mockResolvedValue(null) },
}));
