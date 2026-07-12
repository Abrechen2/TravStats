// #187: the airport dot (routesLayer's "routes-dot") and the port dot
// (cruisePortsLayer's "cruise-ports") must render at the SAME size for
// the same size-slider value. Before the fix the two layers used
// fundamentally different sizing models (unclamped metre radius vs.
// fixed metre radius + pixel clamps), so this test fails on unfixed code.

import { describe, it, expect } from "vitest";
import { createRoutesLayers, type RouteData } from "./routesLayer";
import { createCruisePortsLayer } from "./cruisePortsLayer";
import type { PointDatum } from "./layerTypes";
import type { Cruise } from "../../types";
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
