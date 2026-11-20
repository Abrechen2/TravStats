import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { Layer } from "@deck.gl/core";

// The map is a WebGL canvas; the stand-in exposes what it is handed.
const seen: { layers: readonly Layer[]; points: readonly [number, number][] } = {
  layers: [],
  points: [],
};
vi.mock("../TripMap", () => ({
  default: ({
    extraLayers = [],
    extraPoints = [],
  }: {
    extraLayers?: readonly Layer[];
    extraPoints?: readonly [number, number][];
  }) => {
    seen.layers = extraLayers;
    seen.points = extraPoints;
    return <div data-testid="map" />;
  },
}));
vi.mock("../../../lib/api/tours", () => ({
  toursApi: { list: vi.fn(async () => []), tracks: { list: vi.fn(), get: vi.fn() } },
}));
vi.mock("../../../lib/api/tourIndex", () => ({ tourIndexApi: { geometryBatch: vi.fn() } }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: vi.fn(() => false) }));
vi.mock("../../../hooks/useTravTrackVisible", () => ({ useTravTrackInstanceOn: () => false }));
vi.mock("../../../hooks/usePlacesVisible", () => ({ usePlacesVisible: vi.fn(() => true) }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
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
  },
}));
vi.mock("../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrack")>()),
  travTrackApi: { sharedRoutes: vi.fn(async () => []) },
}));

import TripMapWithTours from "../TripMapWithTours";
import { usePlacesVisible } from "../../../hooks/usePlacesVisible";
import { useMapCardSelectionStore } from "../../../store/mapCardSelectionStore";
import { layerCardAllowed } from "../../map/cards/useMapSelectionCards";

const trip = { id: "t1", flights: [], cruises: [], lodgingStays: [], stops: [] } as never;
const place = (id: string, lat: number, lon: number): never =>
  ({
    id,
    name: id,
    lat,
    lon,
    category: "landmark",
    visited: true,
    visitCount: 1,
    city: null,
    country: null,
    visits: [],
  }) as never;
const visits = [
  { place: place("a", 41.9, 12.49), visit: { id: "v1" } },
  { place: place("a", 41.9, 12.49), visit: { id: "v2" } },
  { place: place("b", 48.85, 2.35), visit: { id: "v3" } },
] as never;

/** Mounts and lets the tour and recording reads settle, so no update lands outside act. */
async function mount(): Promise<void> {
  render(<TripMapWithTours trip={trip} placeVisits={visits} />);
  await act(async () => {});
}

describe("TripMapWithTours — places visited on the trip", () => {
  beforeEach(() => {
    seen.layers = [];
    seen.points = [];
    vi.mocked(usePlacesVisible).mockReturnValue(true);
    useMapCardSelectionStore.getState().clear();
  });

  it("draws one pin per distinct place, frames them and names them in the legend", async () => {
    await mount();
    const pins = seen.layers.find((l) => l.id === "place-pins");
    expect((pins?.props.data as unknown[]).length).toBe(2);
    expect(seen.points).toEqual(
      expect.arrayContaining([
        [12.49, 41.9],
        [2.35, 48.85],
      ])
    );
    expect(screen.getByLabelText("trips:tripPlaces.legend")).toBeInTheDocument();
  });

  it("waits for the places before the map frames the trip, which it does only once", async () => {
    render(<TripMapWithTours trip={trip} placeVisits={[]} placesLoading />);
    await act(async () => {});
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("draws no place and no legend row while the places domain is off", async () => {
    vi.mocked(usePlacesVisible).mockReturnValue(false);
    await mount();
    expect(seen.layers.some((l) => l.id.startsWith("place-pins"))).toBe(false);
    expect(seen.points).toEqual([]);
    expect(screen.queryByLabelText("trips:tripPlaces.legend")).toBeNull();
  });

  it("opens the place card when a pin is clicked", async () => {
    await mount();
    const pins = seen.layers.find((l) => l.id === "place-pins");
    const onClick = pins?.props.onClick as (i: { object: { placeId: string } }) => unknown;
    onClick({ object: { placeId: "b" } });
    const pinned = useMapCardSelectionStore.getState().pinned;
    expect(pinned?.kind).toBe("place");
    expect(pinned?.anchorLngLat).toEqual([2.35, 48.85]);
  });

  it("shows no place card on the trip map once the places domain is switched off", () => {
    const pinned = { kind: "place", anchorLngLat: [1, 2], data: place("a", 2, 1) } as never;
    expect(layerCardAllowed(pinned, (d) => d !== "poi", true)).toBe(false);
    expect(layerCardAllowed(pinned, () => true, true)).toBe(true);
  });
});
