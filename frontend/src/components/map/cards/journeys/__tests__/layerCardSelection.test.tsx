import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { useMapCardSelectionStore } from "../../../../../store/mapCardSelectionStore";
import { layerCardAllowed, useMapSelectionCards } from "../../useMapSelectionCards";
import type { MapPinned } from "../../pinnedTypes";
import { journeyFromRail } from "../journeyNormalize";
import { withTourCards } from "../tourLayerCards";
import { decorateTripMapLayers } from "../../../../Trips/tripMapCards";
import { journeyFromTripFlight } from "../journeyNormalize";
import type { MapJourney } from "../journeyTypes";
import type { TourSummary } from "../../../../../lib/api/tourIndex";
import { occludeExtraLayers } from "../../../../Globe/occludeExtraLayers";
import { EarthOcclusionExtension } from "../../../../Globe/EarthOcclusionExtension";
import { createCruisePortsLayer } from "../../../../layers/cruisePortsLayer";
import type { Cruise } from "../../../../../types/cruise";

const enabled = vi.hoisted(() => ({ keys: ["rail"] as string[], tours: true }));
vi.mock("../../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: enabled.keys,
    isEnabled: (k: string) => enabled.keys.includes(k),
  }),
}));
vi.mock("../../../../../hooks/useToursVisible", () => ({
  useToursVisible: () => enabled.tours,
}));

const RAIL = journeyFromRail({
  id: "r1",
  status: "completed",
  depStationName: "Berlin Hbf",
  depLat: 52.525,
  depLon: 13.369,
  arrStationName: "Hamburg Hbf",
  arrLat: 53.553,
  arrLon: 10.006,
});

function railRoute(domain: MapJourney["domain"] = "rail"): MapPinned {
  return {
    kind: "journeyRoute",
    data: { domain, dep: RAIL.dep, arr: RAIL.arr, journeys: [RAIL], color: [1, 2, 3] },
    anchorLngLat: [12, 53],
  };
}

function click(layer: Layer, object: unknown): void {
  (layer.props.onClick as (i: PickingInfo) => void)({
    object,
    coordinate: [1, 2],
    layer,
  } as unknown as PickingInfo);
}

beforeEach(() => {
  enabled.keys = ["rail"];
  enabled.tours = true;
  useMapCardSelectionStore.setState({ pinned: null, seq: 0 });
});

describe("domain gating", () => {
  it("lets a card through only for a domain the user has on", () => {
    const isEnabled = (k: string): boolean => k === "rail";
    expect(layerCardAllowed(railRoute("rail"), isEnabled, true)).toBe(true);
    expect(layerCardAllowed(railRoute("ferry"), isEnabled, true)).toBe(false);
  });

  it("gates a day tour on tour visibility and a roadtrip on its domain", () => {
    const tour = (kind: "tour" | "roadtrip"): MapPinned => ({
      kind: "tour",
      data: {
        id: "t",
        name: "T",
        kind,
        mode: "foot",
        tripName: null,
        distanceKm: null,
        ascentM: null,
        stopCount: null,
        startDate: null,
        endDate: null,
        color: [0, 0, 0],
      },
      anchorLngLat: [0, 0],
    });
    expect(layerCardAllowed(tour("tour"), () => false, false)).toBe(false);
    expect(layerCardAllowed(tour("tour"), () => false, true)).toBe(true);
    expect(layerCardAllowed(tour("roadtrip"), (k) => k === "roadtrip", false)).toBe(true);
  });

  function mountHook(): { setPinned: ReturnType<typeof vi.fn> } {
    const setPinned = vi.fn();
    renderHook(() =>
      useMapSelectionCards({
        flights: [],
        flightColor: [0, 0, 0],
        focus: vi.fn(),
        setPinned,
        clearOnEmpty: true,
      })
    );
    return { setPinned };
  }

  it("opens a layer card on the mounted map", () => {
    const { setPinned } = mountHook();
    const pinned = railRoute();
    act(() => useMapCardSelectionStore.getState().select(pinned));
    expect(setPinned).toHaveBeenCalledWith(pinned);
  });

  it("hides the card of a domain switched off", () => {
    enabled.keys = [];
    const { setPinned } = mountHook();
    act(() => useMapCardSelectionStore.getState().select(railRoute()));
    expect(setPinned).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "journeyRoute" }));
  });

  it("ignores a selection made before the map mounted", () => {
    useMapCardSelectionStore.getState().select(railRoute());
    const { setPinned } = mountHook();
    expect(setPinned).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "journeyRoute" }));
  });
});

describe("tour lines", () => {
  it("carry their tour's card and open it on click", () => {
    const layer = new PathLayer({
      id: "dashboard-tour-paths",
      data: [{ legId: "l", routeId: "t1", path: [], color: [9, 9, 9] }],
      pickable: true,
    });
    const tours = [
      { id: "t1", name: "Brocken", kind: "tour", mode: "foot", distanceKm: 12, stopCount: 2 },
    ] as unknown as TourSummary[];
    const [decorated] = withTourCards([layer], tours);
    const datum = (decorated.props.data as Array<{ tourCard?: { name: string } }>)[0];
    expect(datum.tourCard?.name).toBe("Brocken");
    click(decorated, datum);
    expect(useMapCardSelectionStore.getState().pinned?.kind).toBe("tour");
  });
});

describe("trip map", () => {
  const flights = [
    journeyFromTripFlight({
      id: "f1",
      status: "flown",
      depIata: "FRA",
      arrIata: "LIS",
      depLat: 50.033,
      depLon: 8.57,
      arrLat: 38.774,
      arrLon: -9.134,
    }),
  ].filter((f): f is MapJourney => f !== null);
  const arcs = new PathLayer({
    id: "trip-flight-arcs",
    data: [{ flightId: "f1", color: [240, 169, 71], path: [] }],
  });
  const airports = new ScatterplotLayer({
    id: "trip-airports",
    data: [{ position: [8.57, 50.033], color: [1, 1, 1] }],
  });
  const stops = new ScatterplotLayer({
    id: "trip-stops",
    data: [
      {
        position: [9, 39],
        color: [2, 2, 2],
        card: { title: "Sintra", domain: "poi", startDate: null, endDate: null, color: [2, 2, 2] },
      },
    ],
  });
  const [a, p, s] = decorateTripMapLayers([arcs, airports, stops], flights);

  it("opens a route card for a flight arc instead of only flying the camera", () => {
    click(a, (a.props.data as unknown[])[0]);
    const pinned = useMapCardSelectionStore.getState().pinned;
    expect(pinned?.kind).toBe("journeyRoute");
    if (pinned?.kind === "journeyRoute") expect(pinned.data.color).toEqual([240, 169, 71]);
  });

  it("opens an airport card and a stop card", () => {
    click(p, (p.props.data as unknown[])[0]);
    expect(useMapCardSelectionStore.getState().pinned?.kind).toBe("journeyStop");
    click(s, (s.props.data as unknown[])[0]);
    expect(useMapCardSelectionStore.getState().pinned?.kind).toBe("tripStop");
  });
});

describe("the globe", () => {
  it("gives the caller's pickable layers the shared hover, keeping a layer's own", () => {
    const hover = vi.fn();
    const own = vi.fn();
    const [plain, withOwn] = occludeExtraLayers(
      [
        new PathLayer({ id: "all-rail-paths", data: [], pickable: true }),
        new PathLayer({ id: "x-paths", data: [], pickable: true, onHover: own }),
      ],
      new EarthOcclusionExtension(),
      { earthOcclusionEnabled: true, earthOcclusionFadeBand: 0.04 },
      hover
    );
    expect(plain.props.onHover).toBe(hover);
    expect(withOwn.props.onHover).toBe(own);
  });
});

describe("cruise ports on the flat map", () => {
  it("open the port card the globe already had", () => {
    const port = { id: 7, name: "Kiel", lat: 54.3, lon: 10.1, country: "DE", city: "Kiel" };
    const cruise = {
      id: "c",
      status: "flown",
      stops: [{ isAtSea: false, port, arrivalTime: "2024-01-01T00:00:00Z" }],
    } as unknown as Cruise;
    const layers = createCruisePortsLayer([cruise], 4) ?? [];
    const dots = layers.find((l) => l.id === "cruise-ports");
    if (!dots) throw new Error("no port layer");
    click(dots, (dots.props.data as unknown[])[0]);
    const pinned = useMapCardSelectionStore.getState().pinned;
    expect(pinned).toMatchObject({ kind: "port", data: { name: "Kiel", size: 1 } });
  });
});
