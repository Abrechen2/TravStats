// #187: the airport dot (routesLayer's "routes-dot") and the port dot
// (cruisePortsLayer's "cruise-ports") must render at the SAME size for
// the same size-slider value. Before the fix the two layers used
// fundamentally different sizing models (unclamped metre radius vs.
// fixed metre radius + pixel clamps), so this test fails on unfixed code.

import { describe, it, expect } from "vitest";
import { createRoutesLayers, type RouteData } from "./routesLayer";
import { createCruisePortsLayer } from "./cruisePortsLayer";
import { buildLodgingPins } from "./lodgingPinsLayer";
import type { PointDatum } from "./layerTypes";
import type { Cruise } from "../../types";
import type { Lodging } from "../../types/lodging";
import { MARKER_DOT_MAX_PX, MARKER_DOT_MIN_PX, MARKER_DOT_RADIUS_M } from "./markerDotStyle";

function makePoint(): PointDatum {
  return {
    position: [8.5, 50.0],
    count: 3,
    name: "Frankfurt Airport",
    iata: "FRA",
  };
}

function makeCruise(): Cruise {
  return {
    id: "c1",
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA Cruises",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: null,
    endDate: null,
    status: "scheduled",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: [
      {
        id: "s1",
        cruiseId: "c1",
        portId: 1,
        port: {
          id: 1,
          name: "Civitavecchia",
          city: "Civitavecchia",
          country: "IT",
          unlocode: null,
          lat: 41.9,
          lon: 12.45,
          timezone: null,
          region: null,
          isUserAdded: false,
        },
        dayNumber: 1,
        isAtSea: false,
        arrivalTime: null,
        departureTime: null,
        excursionNote: null,
      },
    ],
    createdAt: "",
    updatedAt: "",
  } as unknown as Cruise;
}

function makeLodging(): Lodging {
  return {
    id: "lodging-1",
    userId: "u1",
    type: "hotel",
    name: "Hotel Frankfurt",
    chainId: null,
    chain: null,
    address: null,
    city: "Frankfurt",
    country: "DE",
    lat: 50.0,
    lon: 8.5,
    stars: null,
    amenities: [],
    notes: null,
    dataSource: null,
    createdAt: "",
    updatedAt: "",
    stays: [],
    overallRating: null,
    stayCount: 0,
    nights: 0,
    totalSpendBase: 0,
    totalSpendBaseByCurrency: {},
  };
}

interface DotLayerProps {
  getRadius: unknown;
  radiusMinPixels?: number;
  radiusMaxPixels?: number;
}

function getAirportDotProps(sizeScale: number): DotLayerProps {
  const routeData: RouteData = { arcs: [], points: [makePoint()] };
  const layers = createRoutesLayers(routeData, undefined, undefined, 1, [], undefined, 5, {
    markerSizeScale: sizeScale,
  });
  const dotLayer = layers.find((l) => l.id === "routes-dot");
  if (!dotLayer) throw new Error("routes-dot layer not found");
  return (dotLayer as unknown as { props: DotLayerProps }).props;
}

function getPortDotProps(sizeScale: number): DotLayerProps {
  const layers = createCruisePortsLayer([makeCruise()], 5, { portSizeScale: sizeScale });
  if (!layers) throw new Error("createCruisePortsLayer returned null");
  const dotLayer = layers.find((l) => l.id === "cruise-ports");
  if (!dotLayer) throw new Error("cruise-ports layer not found");
  return (dotLayer as unknown as { props: DotLayerProps }).props;
}

function getLodgingDotProps(sizeScale: number): DotLayerProps {
  const layers = buildLodgingPins([makeLodging()], sizeScale);
  if (!layers) throw new Error("buildLodgingPins returned null");
  const dotLayer = layers.find((l) => l.id === "lodging-pins");
  if (!dotLayer) throw new Error("lodging-pins layer not found");
  return (dotLayer as unknown as { props: DotLayerProps }).props;
}

describe("airport dot vs. port dot size parity (#187)", () => {
  it.each([0.7, 1, 1.45])(
    "renders the same radiusMinPixels/radiusMaxPixels for size scale %s",
    (scale) => {
      const airport = getAirportDotProps(scale);
      const port = getPortDotProps(scale);
      expect(airport.radiusMinPixels).toBe(port.radiusMinPixels);
      expect(airport.radiusMaxPixels).toBe(port.radiusMaxPixels);
    }
  );

  it("both dots use the shared MARKER_DOT_RADIUS_M constant as the metre radius", () => {
    const airport = getAirportDotProps(1);
    const port = getPortDotProps(1);
    const resolveRadius = (r: unknown): number => (typeof r === "function" ? r() : (r as number));
    expect(resolveRadius(airport.getRadius)).toBe(MARKER_DOT_RADIUS_M);
    expect(resolveRadius(port.getRadius)).toBe(MARKER_DOT_RADIUS_M);
  });

  it("both dots clamp pixel radius using the shared MIN/MAX constants times the slider", () => {
    const scale = 1.45;
    const airport = getAirportDotProps(scale);
    const port = getPortDotProps(scale);
    expect(airport.radiusMinPixels).toBe(MARKER_DOT_MIN_PX * scale);
    expect(airport.radiusMaxPixels).toBe(MARKER_DOT_MAX_PX * scale);
    expect(port.radiusMinPixels).toBe(MARKER_DOT_MIN_PX * scale);
    expect(port.radiusMaxPixels).toBe(MARKER_DOT_MAX_PX * scale);
  });
});

// Task 8: lodging pins now derive from the SAME markerDotStyle.ts model
// (buildLodgingPins used to hand-copy its own 2200 m constant + hardcoded
// radiusMinPixels:4/radiusMaxPixels:8 with no scale input at all) — so a
// lodging pin must render identically to an airport/port dot at any given
// slider value, and must go fully "Aus" (zero-pixel) at scale 0 exactly
// like the other two.
describe("lodging dot parity with airport/port dots (Task 8)", () => {
  it.each([0.7, 1, 1.45])(
    "renders the same radiusMinPixels/radiusMaxPixels as airport/port dots for size scale %s",
    (scale) => {
      const airport = getAirportDotProps(scale);
      const port = getPortDotProps(scale);
      const lodging = getLodgingDotProps(scale);
      expect(lodging.radiusMinPixels).toBe(airport.radiusMinPixels);
      expect(lodging.radiusMaxPixels).toBe(airport.radiusMaxPixels);
      expect(lodging.radiusMinPixels).toBe(port.radiusMinPixels);
      expect(lodging.radiusMaxPixels).toBe(port.radiusMaxPixels);
    }
  );

  it("uses the shared MARKER_DOT_RADIUS_M constant as its metre radius", () => {
    const lodging = getLodgingDotProps(1);
    const resolveRadius = (r: unknown): number => (typeof r === "function" ? r() : (r as number));
    expect(resolveRadius(lodging.getRadius)).toBe(MARKER_DOT_RADIUS_M);
  });

  it("clamps pixel radius using the shared MIN/MAX constants times the slider", () => {
    const scale = 1.45;
    const lodging = getLodgingDotProps(scale);
    expect(lodging.radiusMinPixels).toBe(MARKER_DOT_MIN_PX * scale);
    expect(lodging.radiusMaxPixels).toBe(MARKER_DOT_MAX_PX * scale);
  });

  it("goes to zero-pixel radius at scale 0 — the same 'Aus' semantics as flight/cruise markers", () => {
    const lodging = getLodgingDotProps(0);
    expect(lodging.radiusMinPixels).toBe(0);
    expect(lodging.radiusMaxPixels).toBe(0);
  });

  it("defaults sizeScale to 1 when called with only lodgings", () => {
    const layers = buildLodgingPins([makeLodging()]);
    if (!layers) throw new Error("buildLodgingPins returned null");
    const dotLayer = layers.find((l) => l.id === "lodging-pins");
    if (!dotLayer) throw new Error("lodging-pins layer not found");
    const props = (dotLayer as unknown as { props: DotLayerProps }).props;
    expect(props.radiusMinPixels).toBe(MARKER_DOT_MIN_PX);
    expect(props.radiusMaxPixels).toBe(MARKER_DOT_MAX_PX);
  });
});
