import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import TripRouteEditorPage from "../TripRouteEditorPage";
import { toursApi } from "../../lib/api/tours";
import { useToastStore } from "../../store/toastStore";
import type { TourRoute } from "../../types/tour";

/**
 * A standalone tour has no trip. Until 2026-09-24 the page's failure guard
 * read `!trip`, so every standalone tour opened on "could not be loaded" —
 * although all its requests answered 200. Found in the browser, pinned here.
 */

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/Trips/TripMap", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../../components/Trips/StravaImportDialog", () => ({
  default: () => null,
  useStravaConnected: () => false,
}));
vi.mock("../../components/Trips/TourRecordingSummary", () => ({ default: () => null }));
vi.mock("../../hooks/useTourTracks", () => ({
  useTourTracks: () => ({
    tracks: [],
    tracksLoading: false,
    tracksLoadError: false,
    loadTracks: vi.fn(),
    tracksWithGeometry: [],
    tracksKnown: true,
    trackUploading: false,
    uploadTrack: vi.fn(),
    trackPulling: false,
    pullDawarichTrack: vi.fn(),
    deleteTrack: vi.fn(),
    dawarichAvailable: false,
  }),
}));
// Coverage is asked of the server (2.7) — not what this suite is about.
vi.mock("../../hooks/useTourTrackCoverage", () => ({
  useTourTrackCoverage: () => ({ coveringTrackByLegId: new Map(), known: true }),
}));
vi.mock("../../lib/api/tours", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api/tours")>();
  return {
    ...original,
    toursApi: {
      ...original.toursApi,
      get: vi.fn(),
      geometry: vi.fn(),
      routeAll: vi.fn(),
    },
  };
});

const ROUTE: TourRoute = {
  id: "r1",
  tripId: null,
  name: "Preikestolen",
  mode: "foot",
  orderIdx: 0,
  color: null,
  notes: null,
  startOdometerKm: null,
  endOdometerKm: null,
  stopCount: 0,
  legCount: 0,
  distanceKm: 0,
  drivenKm: 0,
  kind: "tour",
  activity: "hike",
  vehicle: null,
  vehicleName: null,
  anchorStopId: null,
  kindAssignedAutomatically: false,
};

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/tours/r1"]}>
      <Routes>
        <Route path="/tours/:routeId" element={<TripRouteEditorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("TripRouteEditorPage — a tour with no trip", () => {
  it("shows the tour instead of a load failure", async () => {
    vi.mocked(toursApi.get).mockResolvedValue({
      route: ROUTE,
      stops: [],
      legs: [],
      routingAvailable: false,
    });
    vi.mocked(toursApi.geometry).mockResolvedValue({ type: "FeatureCollection", features: [] });

    renderPage();

    expect(await screen.findByRole("heading", { name: "Preikestolen" })).toBeInTheDocument();
    expect(screen.queryByText("trips:tours.loadError")).not.toBeInTheDocument();
  });
});

describe("TripRouteEditorPage — routing the whole tour", () => {
  it("reports legs that stayed straight apart from routed ones", async () => {
    const stop = (id: string, title: string, lat: number): Record<string, unknown> => ({
      id,
      tripId: null,
      title,
      lat,
      lon: 6.2,
      routeOrderIdx: 0,
    });
    const leg = {
      id: "leg",
      fromStopId: "a",
      toStopId: "b",
      distanceKm: 4,
      source: "straight" as const,
      mode: "foot" as const,
      confidence: "low",
      waypoints: null,
      drivingMinutes: null,
    };
    vi.mocked(toursApi.get).mockResolvedValue({
      route: ROUTE,
      stops: [stop("a", "Parkplatz", 58.99), stop("b", "Preikestolen", 58.98)] as never,
      legs: [leg],
      routingAvailable: true,
    });
    vi.mocked(toursApi.geometry).mockResolvedValue({ type: "FeatureCollection", features: [] });
    vi.mocked(toursApi.routeAll).mockResolvedValue({
      route: ROUTE,
      legs: [leg],
      routedCount: 0,
      fallbackCount: 1,
      fallbackReason: "point_not_near_road",
      skippedCount: 0,
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "trips:tours.routing.routeAll" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
        "trips:tours.routing.resultFallback"
      )
    );
  });
});
