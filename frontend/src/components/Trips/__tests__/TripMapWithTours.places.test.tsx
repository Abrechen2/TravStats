import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Layer } from "@deck.gl/core";

// The map is a WebGL canvas; the stand-in exposes what it is handed.
const seen: {
  layers: readonly Layer[];
  points: readonly [number, number][];
  places: readonly { id: string; name: string }[];
  day: string | null;
} = {
  layers: [],
  points: [],
  places: [],
  day: null,
};
vi.mock("../TripMap", () => ({
  default: ({
    extraLayers = [],
    extraPoints = [],
    places = [],
    day = null,
  }: {
    extraLayers?: readonly Layer[];
    extraPoints?: readonly [number, number][];
    places?: readonly { id: string; name: string }[];
    day?: string | null;
  }) => {
    seen.day = day;
    seen.places = places;
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
import { useTripMapInfoStore } from "../../../store/tripMapInfoStore";
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
    useTripMapInfoStore.getState().close();
  });

  it("draws one pin per distinct place, frames them and hands the map the places to name and number", async () => {
    await mount();
    const pins = seen.layers.find((l) => l.id === "place-pins");
    expect((pins?.props.data as unknown[]).length).toBe(2);
    expect(seen.points).toEqual(
      expect.arrayContaining([
        [12.49, 41.9],
        [2.35, 48.85],
      ])
    );
    expect(seen.places.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("waits for the places before the map frames the trip, which it does only once", async () => {
    render(<TripMapWithTours trip={trip} placeVisits={[]} placesLoading />);
    await act(async () => {});
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("draws no place and names none while the places domain is off", async () => {
    vi.mocked(usePlacesVisible).mockReturnValue(false);
    await mount();
    expect(seen.layers.some((l) => l.id.startsWith("place-pins"))).toBe(false);
    expect(seen.points).toEqual([]);
    expect(seen.places).toEqual([]);
  });

  it("opens the trip map's info card, linked to the place and its visit, when a pin is clicked", async () => {
    await mount();
    const pins = seen.layers.find((l) => l.id === "place-pins");
    const onClick = pins?.props.onClick as (i: { object: { placeId: string } }) => unknown;
    onClick({ object: { placeId: "b" } });
    const info = useTripMapInfoStore.getState().info;
    expect(info?.kind).toBe("place");
    expect(info?.entityHref).toBe("/places/b");
    expect(info?.timelineHref).toBe("/trips/t1?tab=timeline#timeline-place-visit-v3");
  });

  it("shows no place card on the trip map once the places domain is switched off", () => {
    const pinned = { kind: "place", anchorLngLat: [1, 2], data: place("a", 2, 1) } as never;
    expect(layerCardAllowed(pinned, (d) => d !== "poi", true)).toBe(false);
    expect(layerCardAllowed(pinned, () => true, true)).toBe(true);
  });
});

describe("TripMapWithTours — the day strip", () => {
  const dated = [
    { place: place("a", 41.9, 12.49), visit: { id: "v1", visitedAt: "2026-05-01T10:00:00" } },
    { place: place("b", 48.85, 2.35), visit: { id: "v3", visitedAt: "2026-05-02T10:00:00" } },
  ] as never;

  it("hands the chosen day to the map and draws the other days' places faint, then resets on 'all days'", async () => {
    vi.mocked(usePlacesVisible).mockReturnValue(true);
    render(<TripMapWithTours trip={trip} placeVisits={dated} />);
    await act(async () => {});
    expect(seen.day).toBeNull();
    expect(seen.layers.some((l) => l.id.endsWith("-dim"))).toBe(false);

    await userEvent.click(screen.getAllByRole("button", { name: /days\.dayN/ })[0]);
    const live = seen.layers.find((l) => l.id === "place-pins");
    const faint = seen.layers.find((l) => l.id === "place-pins-dim");
    expect(seen.day).toBe("2026-05-01");
    expect((live?.props.data as Array<{ placeId: string }>).map((d) => d.placeId)).toEqual(["a"]);
    expect((faint?.props.data as Array<{ placeId: string }>).map((d) => d.placeId)).toEqual(["b"]);
    expect(faint?.props.opacity).toBeLessThan(0.5);
    expect(faint?.props.pickable).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "trips:detail.map.days.all" }));
    expect(seen.day).toBeNull();
    expect(seen.layers.some((l) => l.id.endsWith("-dim"))).toBe(false);
  });
});
