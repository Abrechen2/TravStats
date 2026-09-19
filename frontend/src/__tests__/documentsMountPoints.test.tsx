import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Cruise, Flight, Trip } from "../types";
import type { LodgingStay } from "../types/lodging";

/**
 * Five surfaces, five entry types — the wiring the 2.7.0 what's-new promised.
 *
 * `backend/src/routes/documents.ts` serves documents under five per-entry
 * prefixes. A section that exists but is mounted nowhere is exactly the state
 * the beta audit of 2026-09-19 found (the API shipped, the Companion used it,
 * the web had no screen at all), so each mount gets a test of its own rather
 * than being left to a manual look.
 *
 * `DocumentsSection` itself is stubbed here and records the `entry` it was
 * handed: what is under test is which record each page files documents
 * against, not the section, which has its own suite.
 */
const mounted = vi.hoisted(() => [] as { type: string; id: string }[]);

vi.mock("../components/documents/DocumentsSection", () => ({
  default: ({ entry }: { entry: { type: string; id: string } }) => {
    mounted.push(entry);
    return <div data-testid={`documents-${entry.type}`} />;
  },
}));

// ── the five surfaces' own dependencies ────────────────────────────────────
const flightsApi = vi.hoisted(() => ({ getById: vi.fn(), update: vi.fn(), delete: vi.fn() }));
const cruiseApi = vi.hoisted(() => ({ get: vi.fn(), remove: vi.fn() }));

vi.mock("../lib/api", () => ({
  flightsApi,
  cruiseApi,
  tripsApi: { getAll: vi.fn().mockResolvedValue([]), summarize: vi.fn() },
}));
vi.mock("../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../lib/api/places", () => ({
  getPlace: vi.fn(),
  createVisit: vi.fn(),
  deleteVisit: vi.fn(),
  deletePlace: vi.fn(),
}));
vi.mock("../lib/api/lodging", () => ({
  createStay: vi.fn(),
  updateStay: vi.fn(),
  listMemberships: vi.fn().mockResolvedValue([]),
  getFxPreview: vi.fn(),
}));
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});
vi.mock("../hooks/usePlacesVisible", () => ({
  usePlacesAccess: () => ({ visible: true, loading: false }),
}));
// The trip surface renders the summary card, which since f52c3657 asks the
// instance whether it has a text model at all (`GET /parser-capabilities`).
// Landed here by a clean merge, not by a conflict: neither side's text
// overlapped, so only running the suite showed it.
vi.mock("../hooks/useHasLlm", () => ({ useHasLlm: () => true }));
vi.mock("../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));
vi.mock("../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => false }),
}));
vi.mock("../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../components/FlightEditModal", () => ({ default: () => null }));
vi.mock("../components/SpecialFlightModal", () => ({ default: () => null }));
vi.mock("../components/Cruise/CruiseEditModal", () => ({ CruiseEditModal: () => null }));
vi.mock("../components/Cruise/CruiseRouteMap", () => ({ CruiseRouteMap: () => <div /> }));
vi.mock("../components/location/LocationMiniMap", () => ({ LocationMiniMap: () => <div /> }));
vi.mock("../components/places/VisitPhotoStrip", () => ({ VisitPhotoStrip: () => <div /> }));

import { getPlace } from "../lib/api/places";
import FlightDetailPage from "../pages/FlightDetailPage";
import CruiseDetailPage from "../pages/CruiseDetailPage";
import PlaceDetailPage from "../pages/PlaceDetailPage";
import TripOverview from "../components/Trips/TripOverview";
import { StayEditor } from "../components/lodging/StayEditor";

const FLIGHT = {
  id: "flight-1",
  airline: "Lufthansa",
  flightNumber: "LH2462",
  depIata: "MUC",
  arrIata: "CPH",
  departureTime: "2026-12-21T18:06:00.000Z",
  arrivalTime: "2026-12-21T19:36:00.000Z",
  status: "scheduled",
  createdAt: "2026-01-01T00:00:00.000Z",
} as Flight;

const CRUISE = {
  id: "cruise-1",
  userId: "user-1",
  shipId: null,
  ship: null,
  shipNameOverride: "AIDAnova",
  cruiseLine: "AIDA",
  routeName: null,
  departurePortId: null,
  departurePort: null,
  arrivalPortId: null,
  arrivalPort: null,
  startDate: "2024-05-13T00:00:00.000Z",
  endDate: "2024-05-20T00:00:00.000Z",
  status: "flown",
  cabinNumber: null,
  cabinType: null,
  deck: null,
  bookingReference: null,
  price: null,
  currency: null,
  notes: null,
  tags: [],
  companions: [],
  tripId: null,
  bookingId: null,
  stops: [],
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
} as unknown as Cruise;

const TRIP = {
  id: "trip-1",
  name: "Probe",
  startDate: null,
  endDate: null,
  status: "completed",
  tags: [],
  companions: [],
  notes: null,
  summary: null,
  countries: [],
  flights: [],
  cruises: [],
  lodgingStays: [],
  bookings: [],
} as unknown as Trip;

const STAY = {
  id: "stay-1",
  lodgingId: "lodging-1",
  userId: "user-1",
  tripId: null,
  bookingId: null,
  checkInTime: null,
  checkOutTime: null,
  checkIn: "2026-07-11T00:00:00.000Z",
  checkOut: "2026-07-12T00:00:00.000Z",
  datePrecision: "DAY",
  nights: null,
  status: "completed",
  roomNumber: null,
  roomCategory: null,
  board: "none",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as LodgingStay;

function routed(path: string, url: string, element: JSX.Element): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>
  );
}

describe("the documents section is mounted on every entry the API serves", () => {
  beforeEach(() => {
    mounted.length = 0;
    flightsApi.getById.mockReset().mockResolvedValue(FLIGHT);
    cruiseApi.get.mockReset().mockResolvedValue(CRUISE);
    vi.mocked(getPlace).mockReset();
  });

  it("files a flight's documents against the flight — /flights/:id/documents", async () => {
    routed("/flights/:id", "/flights/flight-1", <FlightDetailPage />);
    await waitFor(() => expect(mounted).toEqual([{ type: "flight", id: "flight-1" }]));
  });

  it("files a cruise's documents against the cruise — /cruises/:id/documents", async () => {
    routed("/cruises/:id", "/cruises/cruise-1", <CruiseDetailPage />);
    await waitFor(() => expect(mounted).toEqual([{ type: "cruise", id: "cruise-1" }]));
  });

  it("files a stay's documents against the STAY — /lodging/stays/:id/documents", async () => {
    render(
      <MemoryRouter>
        <StayEditor
          mode="edit"
          lodgingId="lodging-1"
          stay={STAY}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </MemoryRouter>
    );
    await waitFor(() => expect(mounted).toEqual([{ type: "lodgingStay", id: "stay-1" }]));
  });

  it("offers no documents while a stay is being CREATED — there is no id yet", async () => {
    render(
      <MemoryRouter>
        <StayEditor
          mode="create"
          lodgingId="lodging-1"
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </MemoryRouter>
    );
    await screen.findByText("lodging:stayEditor.receiptSection");
    expect(mounted).toEqual([]);
  });

  it("files a place's documents against the VISIT — /places/visits/:id/documents", async () => {
    vi.mocked(getPlace).mockResolvedValue({
      id: "p1",
      name: "Wartburg",
      category: "landmark",
      country: "DE",
      city: null,
      address: null,
      lat: 50.9661,
      lon: 10.3064,
      visited: true,
      visits: [
        { id: "visit-1", placeId: "p1", visitedAt: "2026-05-01T00:00:00.000Z" },
        // A visit still ahead. A ticket exists BEFORE the day it is used, and
        // the backend accepts one against a planned visit, so hiding the
        // section here would refuse the commonest case there is.
        { id: "visit-2", placeId: "p1", visitedAt: "2099-05-01T00:00:00.000Z" },
      ],
      // The catalogue place is always there; the ticket belongs to the day.
    } as unknown as Awaited<ReturnType<typeof getPlace>>);

    routed("/places/:id", "/places/p1", <PlaceDetailPage />);
    await waitFor(() =>
      expect(mounted).toEqual([
        { type: "placeVisit", id: "visit-1" },
        { type: "placeVisit", id: "visit-2" },
      ])
    );
  });

  it("files a trip's documents against the trip — /trips/:id/documents", async () => {
    render(
      <MemoryRouter>
        <TripOverview
          trip={TRIP}
          t={((key: string) => key) as never}
          language="de"
          onChanged={() => undefined}
        />
      </MemoryRouter>
    );
    await waitFor(() => expect(mounted).toEqual([{ type: "trip", id: "trip-1" }]));
  });
});
