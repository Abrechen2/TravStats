import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import TripRouteEditorPage from "../TripRouteEditorPage";
import { toursApi } from "../../lib/api/tours";

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
vi.mock("../../lib/api/tours", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api/tours")>();
  return {
    ...original,
    toursApi: {
      ...original.toursApi,
      get: vi.fn(),
      geometry: vi.fn(),
    },
  };
});

describe("TripRouteEditorPage — a tour with no trip", () => {
  it("shows the tour instead of a load failure", async () => {
    vi.mocked(toursApi.get).mockResolvedValue({
      route: {
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
      },
      stops: [],
      legs: [],
      routingAvailable: false,
    });
    vi.mocked(toursApi.geometry).mockResolvedValue({ type: "FeatureCollection", features: [] });

    render(
      <MemoryRouter initialEntries={["/tours/r1"]}>
        <Routes>
          <Route path="/tours/:routeId" element={<TripRouteEditorPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Preikestolen" })).toBeInTheDocument();
    expect(screen.queryByText("trips:tours.loadError")).not.toBeInTheDocument();
  });
});
