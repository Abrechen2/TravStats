import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Trip } from "../../types";

/**
 * Places on the trip page: one read feeds the head count, the timeline and the
 * map, and a failed read is said on the trip rather than shown as "no places".
 */
const getByIdMock = vi.fn();

// The page renders the summary card, which asks the instance whether it has a
// text model at all (`GET /parser-capabilities`). The network guard fails any
// test that lets that request out (forgejo#110).
// Shared trips (2026-10-09): the trip overview, the settings and the inbox
// read the sharing API on mount; answered empty so no request escapes.
vi.mock("../../components/Trips/TripPackingCard", () => ({ default: () => null }));
vi.mock("../../components/Trips/photoLinks/TripPhotosCard", () => ({ default: () => null }));
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

// Notes on the trip's days (forgejo#146) have their own suite
// (`tripNotesTimeline.test.tsx`); answered empty so no request escapes.
vi.mock("../../hooks/useTripNotes", () => ({
  useTripNotes: () => ({ notes: null, failed: false, reload: () => {} }),
}));

vi.mock("../../lib/api/places", () => ({ listPlaces: vi.fn() }));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));

// The tile must follow the UI language: "40.206 €" in German is exactly the
// spelling the old string interpolation could never produce.
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}/${o.count}` : k),
    i18n: { language: "de" },
  }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

// The overview's roadtrip list has its own endpoint and its own test.
vi.mock("../../components/Roadtrips/useTripRoadtrips", () => ({ useTripRoadtrips: () => [] }));

import TripDetailPage from "../TripDetailPage";
import { listPlaces } from "../../lib/api/places";
import { logger } from "../../lib/logger";

const trip = {
  id: "trip-1",
  name: "Ortsprobe",
  status: "completed",
  startDate: "2024-05-13T00:00:00.000Z",
  endDate: "2024-05-15T00:00:00.000Z",
  countries: [],
  flights: [],
  cruises: [],
  stops: [],
  journalEntries: [],
  photos: [],
  lodgingStays: [],
  bookings: [],
  tags: [],
  companions: [],
} as unknown as Trip;

const visited = (id: string, tripId: string): never =>
  ({
    id,
    name: id,
    category: "landmark",
    lat: 1,
    lon: 2,
    visited: true,
    visits: [{ id: `v-${id}`, placeId: id, tripId, visitedAt: "2024-05-14T10:00:00.000Z" }],
  }) as never;

async function open(): Promise<void> {
  getByIdMock.mockResolvedValue(trip);
  render(
    <MemoryRouter initialEntries={["/trips/trip-1"]}>
      <Routes>
        <Route path="/trips/:id" element={<TripDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText(trip.name);
}

describe("TripDetailPage places", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says the places could not be loaded, instead of showing a trip that looks placeless", async () => {
    vi.mocked(listPlaces)
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValue([visited("p1", "trip-1"), visited("p2", "trip-1")]);
    await open();

    const line = await screen.findByTestId("trip-places-error");
    expect(line).toHaveTextContent("trips:tripPlaces.loadError");
    expect(logger.warn).toHaveBeenCalled();
    expect(screen.queryByTestId("trip-head-places")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "trips:tripPlaces.retry" }));
    await waitFor(() => expect(screen.queryByTestId("trip-places-error")).toBeNull());
    expect(screen.getByTestId("trip-head-places")).toHaveTextContent("2 trips:card.places/2");
  });

  it("reads the places once for the head, the timeline and the map", async () => {
    vi.mocked(listPlaces).mockResolvedValue([visited("p1", "trip-1")]);
    await open();
    await screen.findByTestId("trip-head-places");
    await userEvent.click(screen.getByText("trips:detail.tabs.timeline"));
    await screen.findByText(/trips:detail\.timeline\.placeVisited/);
    expect(listPlaces).toHaveBeenCalledTimes(1);
  });
});
