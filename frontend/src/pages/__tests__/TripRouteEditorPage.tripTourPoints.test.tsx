import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import TripRouteEditorPage from "../TripRouteEditorPage";
import { toursApi } from "../../lib/api/tours";
import { tripsApi } from "../../lib/api";
import type { TourRoute } from "../../types/tour";

/**
 * Acceptance D5 (2026-09-26): a day tour that joined a trip kept its own
 * points, and saving them answered 409 with English text and a stack — the
 * page showed nothing. The trip page now edits such a tour's own points on
 * the trip's path, and a refused save says why, in the reader's words.
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
vi.mock("../../components/Trips/PlannedProfileCard", () => ({ default: () => null }));
vi.mock("../../components/location/LocationInput", () => ({
  LocationInput: () => <div data-testid="location-input" />,
}));
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
vi.mock("../../lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api")>();
  return { ...original, tripsApi: { ...original.tripsApi, getById: vi.fn() } };
});
vi.mock("../../lib/api/tours", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api/tours")>();
  return {
    ...original,
    toursApi: { ...original.toursApi, get: vi.fn(), geometry: vi.fn(), replacePoints: vi.fn() },
  };
});

const ROUTE: TourRoute = {
  id: "r1",
  tripId: "t1",
  name: "Besseggen",
  mode: "foot",
  orderIdx: 0,
  color: null,
  notes: null,
  startOdometerKm: null,
  endOdometerKm: null,
  stopCount: 2,
  legCount: 1,
  distanceKm: 4,
  drivenKm: 0,
  kind: "tour",
  activity: "hike",
  vehicle: null,
  vehicleName: null,
  anchorStopId: null,
  kindAssignedAutomatically: false,
};

const ownPoint = (id: string, title: string): Record<string, unknown> => ({
  id,
  tripId: null,
  title,
  lat: 61.5,
  lon: 8.8,
  routeOrderIdx: 0,
  notes: null,
});

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/trips/t1/routes/r1"]}>
      <Routes>
        <Route path="/trips/:id/routes/:routeId" element={<TripRouteEditorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("TripRouteEditorPage — a day tour that joined a trip", () => {
  beforeEach(() => {
    vi.mocked(tripsApi.getById).mockResolvedValue({
      id: "t1",
      name: "Norwegen",
      stops: [],
    } as never);
    vi.mocked(toursApi.get).mockResolvedValue({
      route: ROUTE,
      stops: [ownPoint("a", "Gjendesheim"), ownPoint("b", "Memurubu")] as never,
      legs: [],
      routingAvailable: false,
    });
    vi.mocked(toursApi.geometry).mockResolvedValue({ type: "FeatureCollection", features: [] });
  });

  it("edits the tour's own points on the trip's path", async () => {
    vi.mocked(toursApi.replacePoints).mockResolvedValue({
      route: ROUTE,
      stops: [ownPoint("a", "Gjendesheim"), ownPoint("b", "Memurubu")] as never,
      legs: [],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "trips:tours.points.save" }));
    await waitFor(() => expect(toursApi.replacePoints).toHaveBeenCalled());
    // The save re-reads the geometry; wait for it so no update lands after the test.
    await waitFor(() => expect(toursApi.geometry).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "trips:tours.points.save" })).toBeEnabled()
    );
    expect(vi.mocked(toursApi.replacePoints).mock.calls[0].slice(0, 2)).toEqual(["t1", "r1"]);
  });

  it("says why a refused save was refused, instead of nothing", async () => {
    vi.mocked(toursApi.replacePoints).mockRejectedValue({
      response: {
        status: 409,
        data: { error: "This tour is built from its trip's stops", code: "TOUR_POINTS_FROM_TRIP" },
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "trips:tours.points.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "trips:tours.points.saveErrorFromTrip"
    );
    expect(screen.queryByText(/This tour is built/)).not.toBeInTheDocument();
  });
});
