import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Trip } from "../../types";

// Rail journeys on the trip page (spec 2026-09-25-rail-domain, phase 2b): an
// entry on the timeline and a row in the logistics list — both ONLY while the
// rail beta switch and the domain are on (owner rule 2026-09-25). The page
// scaffolding is the lodging-stays suite's.

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

// The global settingsStore mock (src/__tests__/setup.ts) has no
// `enabledDomains`, which the real useEnabledDomains hook needs — stub the
// hook directly so every domain reads as enabled for this test.
// Places left the beta gate with the 2.7 line, so the trip timeline now asks
// for the trip's place visits unconditionally. Unmocked that went out as a
// real request, which the suite's network guard fails rather than prints
// (forgejo#110).
vi.mock("../../lib/api/places", () => ({
  listPlaces: () => Promise.resolve([]),
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));

const railVisible = vi.hoisted(() => ({ value: true }));
vi.mock("../../hooks/useRailVisible", () => ({ useRailVisible: () => railVisible.value }));

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
    </MemoryRouter>
  );
  await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
  // Wait for the loading placeholder to clear before switching tabs.
  await screen.findByText(trip.name);
}

const ride = {
  id: "rail-1",
  operator: "DB Fernverkehr",
  trainCategory: "ICE",
  trainNumber: "578",
  depStationName: "Frankfurt (Main) Hbf",
  arrStationName: "Zürich HB",
  depTimezone: "Europe/Berlin",
  arrTimezone: "Europe/Zurich",
  departureTime: "2024-05-13T06:00:00.000Z",
  arrivalTime: "2024-05-13T10:00:00.000Z",
  distanceKm: 330,
  distanceSource: "great_circle" as const,
  status: "completed" as const,
  delayMinutes: null,
  price: null,
  currency: "EUR",
  bookingId: null,
};

describe("TripDetailPage — rail journeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    railVisible.value = true;
  });

  it("puts a ride on the timeline, linking to its journey", async () => {
    await renderTripDetail(makeTrip({ railJourneys: [ride] }));
    await userEvent.click(screen.getByText("trips:detail.tabs.timeline"));
    expect(await screen.findByText("Frankfurt (Main) Hbf → Zürich HB")).toBeInTheDocument();
    // The card opens in place; its link to the journey's own page is inside.
    await userEvent.click(screen.getByText("Frankfurt (Main) Hbf → Zürich HB"));
    expect(await screen.findByTestId("rail-trip-card-open")).toHaveAttribute(
      "href",
      "/rail/rail-1"
    );
  });

  it("lists the rides among the trip's logistics", async () => {
    await renderTripDetail(makeTrip({ railJourneys: [ride] }));
    await userEvent.click(screen.getByText("trips:detail.tabs.logistics"));
    expect(await screen.findByTestId("trip-rail-list")).toBeInTheDocument();
  });

  it("shows no ride anywhere while rail is hidden behind its beta switch", async () => {
    railVisible.value = false;
    await renderTripDetail(makeTrip({ railJourneys: [ride] }));
    await userEvent.click(screen.getByText("trips:detail.tabs.timeline"));
    expect(screen.queryByText("Frankfurt (Main) Hbf → Zürich HB")).toBeNull();
    await userEvent.click(screen.getByText("trips:detail.tabs.logistics"));
    expect(screen.queryByTestId("trip-rail-list")).toBeNull();
  });
});
