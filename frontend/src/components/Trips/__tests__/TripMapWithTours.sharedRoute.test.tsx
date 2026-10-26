import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Layer } from "@deck.gl/core";

// The map is a WebGL canvas; the stand-in lists the extra layers it is handed.
vi.mock("../TripMap", () => ({
  default: ({ extraLayers = [] }: { extraLayers?: readonly Layer[] }) => (
    <ul data-testid="map">
      {extraLayers.map((layer) => (
        <li key={layer.id} data-testid={layer.id}>
          {(layer.props.data as unknown[]).length}
        </li>
      ))}
    </ul>
  ),
}));
vi.mock("../../../lib/api/tours", () => ({
  toursApi: { list: vi.fn(async () => []), tracks: { list: vi.fn(), get: vi.fn() } },
}));
vi.mock("../../../lib/api/tourIndex", () => ({ tourIndexApi: { geometryBatch: vi.fn() } }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: vi.fn(() => false) }));
vi.mock("../../../hooks/useTravTrackVisible", () => ({
  useTravTrackInstanceOn: vi.fn(() => true),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/api/tripRecording", () => ({
  tripRecordingApi: {
    get: vi.fn(async () => ({
      summary: {
        pointCount: 0,
        jitterDropped: 0,
        firstAt: null,
        lastAt: null,
        devices: [],
        days: [],
      },
      segments: [],
    })),
    downloadGpx: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrack")>()),
  travTrackApi: { sharedRoutes: vi.fn() },
}));

import TripMapWithTours from "../TripMapWithTours";
import { travTrackApi } from "../../../lib/api/travtrack";
import { useTravTrackInstanceOn } from "../../../hooks/useTravTrackVisible";

const trip = { id: "copy-1", flights: [], cruises: [], lodgingStays: [], stops: [] } as never;
const sharedRoutes = vi.mocked(travTrackApi.sharedRoutes);

describe("TripMapWithTours — a route another member shares", () => {
  beforeEach(() => {
    sharedRoutes.mockReset();
    vi.mocked(useTravTrackInstanceOn).mockReturnValue(true);
  });

  it("draws the shared route read-only and names whose it is", async () => {
    sharedRoutes.mockResolvedValue([
      {
        version: 2,
        sharedBy: "Alex Muster",
        geometry: [
          [
            [127, 37.5],
            [127.1, 37.5],
          ],
          [[128, 37.6]],
        ],
      },
    ]);
    render(<TripMapWithTours trip={trip} />);
    expect(await screen.findByText(/trips:sharedRoute.legend.*Alex Muster/)).toBeInTheDocument();
    // One drawable line: a single vertex draws nothing.
    expect(screen.getByTestId("trip-shared-route-0")).toHaveTextContent("1");
    expect(sharedRoutes).toHaveBeenCalledWith("copy-1");
  });

  it("says when the shared route could not be read, instead of showing none", async () => {
    sharedRoutes.mockRejectedValue(new Error("network"));
    render(<TripMapWithTours trip={trip} />);
    expect(await screen.findByText("trips:sharedRoute.loadError")).toBeInTheDocument();
    expect(screen.queryByTestId("trip-shared-route-0")).toBeNull();
  });

  it("draws and labels nothing when nobody shares a route", async () => {
    sharedRoutes.mockResolvedValue([]);
    render(<TripMapWithTours trip={trip} />);
    await waitFor(() => expect(sharedRoutes).toHaveBeenCalled());
    expect(screen.queryByText(/trips:sharedRoute/)).toBeNull();
  });

  it("does not ask where TravTrack is not shown", async () => {
    vi.mocked(useTravTrackInstanceOn).mockReturnValue(false);
    render(<TripMapWithTours trip={trip} />);
    await screen.findByTestId("map");
    expect(sharedRoutes).not.toHaveBeenCalled();
  });
});
