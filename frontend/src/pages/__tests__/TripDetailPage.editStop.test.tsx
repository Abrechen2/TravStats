import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Trip } from "../../types";

/**
 * `?tab=timeline&editStop=<id>` — the inbox's link for a trip stop whose zone
 * or time the time-model migration could not resolve (ADR 0002, plan Phase
 * 3b). It must open THAT stop's editor, not leave the user to find it among
 * the timeline's entries — and say so when the stop no longer exists.
 */

const getByIdMock = vi.fn();
const toasts = vi.hoisted(() => ({ addToast: vi.fn() }));

vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...a: unknown[]) => void }) => unknown) =>
    selector({ addToast: toasts.addToast }),
}));
vi.mock("../../hooks/useToursVisible", () => ({
  useToursVisible: () => true,
  useToursAccess: () => "allowed",
}));
vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../lib/api", () => ({
  tripsApi: { getById: (...args: unknown[]) => getByIdMock(...args) },
}));
vi.mock("../../lib/api/places", () => ({ listPlaces: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/api/tours", () => ({
  toursApi: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/Trips/StopModal", () => ({
  default: ({ stop }: { stop: { id: string } | null }) => (
    <div data-testid="stop-editor">{stop?.id ?? "new"}</div>
  ),
}));

import TripDetailPage from "../TripDetailPage";

function makeTrip(): Trip {
  return {
    id: "trip-1",
    userId: "user-1",
    name: "Nepal",
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
    stops: [
      {
        id: "s1",
        tripId: "trip-1",
        orderIdx: 0,
        domain: null,
        sourceId: null,
        title: "Kathmandu",
        description: null,
        startDate: "2024-05-13T00:00:00.000Z",
        endDate: null,
        lat: 27.7,
        lon: 85.3,
        notes: null,
      },
    ],
    journalEntries: [],
    photos: [],
    lodgingStays: [],
    bookings: [],
  } as unknown as Trip;
}

function LocationProbe(): JSX.Element {
  return <div data-testid="search">{useLocation().search}</div>;
}

async function renderAt(entry: string): Promise<void> {
  getByIdMock.mockResolvedValue(makeTrip());
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/trips/:id"
          element={
            <>
              <TripDetailPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText("Nepal");
}

describe("the trip page opens a stop's editor from a link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens exactly the named stop, and keeps the tab while dropping the parameter", async () => {
    await renderAt("/trips/trip-1?tab=timeline&editStop=s1");

    expect(await screen.findByTestId("stop-editor")).toHaveTextContent("s1");
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe("?tab=timeline"));
  });

  it("says the stop is gone instead of opening an editor for a new one", async () => {
    await renderAt("/trips/trip-1?tab=timeline&editStop=gone");

    await waitFor(() =>
      expect(toasts.addToast).toHaveBeenCalledWith("error", "trips:detail.stopNotFound")
    );
    expect(screen.queryByTestId("stop-editor")).not.toBeInTheDocument();
  });
});
