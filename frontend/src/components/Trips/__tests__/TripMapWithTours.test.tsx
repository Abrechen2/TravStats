import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TourGeometry } from "../../../types/tour";

// The map is a WebGL canvas; the stand-in draws what the tour layer is handed —
// one entry per line segment with the label its tooltip would show.
vi.mock("../TripMap", async () => {
  const { buildTourPaths } = await import("../../layers/tourPathsLayer");
  return {
    default: ({
      tourGeometries = [],
    }: {
      tourGeometries?: Parameters<typeof buildTourPaths>[0];
    }) => (
      <ul data-testid="tour-lines">
        {buildTourPaths(tourGeometries).map((p) => (
          <li key={p.legId} data-roadtrip={String(p.isRoadtrip)}>
            {p.label}
          </li>
        ))}
      </ul>
    ),
  };
});
vi.mock("../../../lib/api/tours", () => ({
  toursApi: { list: vi.fn(), tracks: { list: vi.fn(), get: vi.fn() } },
}));
vi.mock("../../../lib/api/tourIndex", () => ({ tourIndexApi: { geometryBatch: vi.fn() } }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: vi.fn(() => true) }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import TripMapWithTours from "../TripMapWithTours";
import { toursApi } from "../../../lib/api/tours";
import { tourIndexApi } from "../../../lib/api/tourIndex";
import { useToursVisible } from "../../../hooks/useToursVisible";

const legs: TourGeometry = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [6.64, 49.75],
          [7.1, 50.0],
        ],
      },
      properties: {
        legId: "leg-1",
        source: "routed",
        mode: "bike",
        confidence: "high",
        distanceKm: 61.7,
      },
    },
  ],
} as TourGeometry;

const trip = { id: "trip-1", flights: [], cruises: [], lodgingStays: [], stops: [] } as never;

describe("TripMapWithTours", () => {
  beforeEach(() => {
    vi.mocked(useToursVisible).mockReturnValue(true);
    vi.mocked(toursApi.list)
      .mockReset()
      .mockResolvedValue([
        { id: "tour-mosel", name: "Mosel", kind: "tour", mode: "bike" },
      ] as never);
    vi.mocked(tourIndexApi.geometryBatch)
      .mockReset()
      .mockResolvedValue(new Map([["tour-mosel", legs]]));
    vi.mocked(toursApi.tracks.list)
      .mockReset()
      .mockResolvedValue([{ id: "trk-1", distanceKm: 200.6 }] as never);
    vi.mocked(toursApi.tracks.get)
      .mockReset()
      .mockResolvedValue({
        id: "trk-1",
        geometry: [
          [6.64, 49.75],
          [7.6, 50.36],
        ],
      } as never);
  });

  // Acceptance 2026-09-26: the trip's "Karte" tab showed the stations only.
  it("draws a trip's tour — its routed legs and its recording", async () => {
    render(<TripMapWithTours trip={trip} />);
    expect(await screen.findByText("Mosel · 62 km")).toBeInTheDocument();
    expect(screen.getByText("Mosel · 201 km")).toBeInTheDocument();
    expect(toursApi.list).toHaveBeenCalledWith("trip-1");
  });

  it("says so when the tours could not be loaded, instead of looking tourless", async () => {
    vi.mocked(toursApi.list).mockRejectedValue(new Error("offline"));
    render(<TripMapWithTours trip={trip} />);
    expect(await screen.findByText("trips:tours.map.loadError")).toBeInTheDocument();
  });

  it("asks for nothing while tours are behind the beta gate", async () => {
    vi.mocked(useToursVisible).mockReturnValue(false);
    render(<TripMapWithTours trip={trip} />);
    await screen.findByTestId("tour-lines");
    expect(toursApi.list).not.toHaveBeenCalled();
  });
});
