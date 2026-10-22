import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { ferryFixture } from "./ferryFixture";

/**
 * The ferry detail map draws what the dashboard draws: the crossing's stored
 * sea route where there is one, else the chord between the ports — through
 * the dashboard's own layer builder — and the caption says which line it is.
 */
const buildLayers = vi.hoisted(() => vi.fn((..._args: unknown[]) => []));
vi.mock("../../Dashboard/tabs/terminalRideMapOverlay", () => ({
  buildTerminalRideMapLayers: buildLayers,
}));
vi.mock("react-map-gl/maplibre", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  useControl: () => ({ setProps: vi.fn() }),
}));
vi.mock("@deck.gl/mapbox", () => ({ MapboxOverlay: vi.fn() }));
vi.mock("../../map/SharedMapOverlays", () => ({ SharedMapOverlays: () => null }));
vi.mock("../../map/useBasemapStyle", () => ({ useBasemapStyle: () => "style.json" }));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colorOf: () => "#5686b8" }),
}));

import { FerryRouteMap, ferryMapLine } from "../FerryRouteMap";

const SEA: [number, number][] = [
  [127.0, 37.5],
  [128.0, 38.5],
  [128.59, 38.19],
];

describe("ferryMapLine", () => {
  it("is the stored sea route when one is stored", () => {
    expect(ferryMapLine(ferryFixture({ geometry: SEA, geometrySource: "sea_route" }))).toEqual({
      path: SEA,
      kind: "seaRoute",
    });
  });

  it("is a stored line of another source, named as such", () => {
    expect(ferryMapLine(ferryFixture({ geometry: SEA, geometrySource: "manual" }))?.kind).toBe(
      "drawn"
    );
  });

  it("falls back to the chord between the ports, as the dashboard does", () => {
    const ride = ferryFixture({ geometry: null });
    expect(ferryMapLine(ride)).toEqual({
      path: [
        [ride.depLon, ride.depLat],
        [ride.arrLon, ride.arrLat],
      ],
      kind: "straight",
    });
  });

  it("still draws a cancelled crossing on its own page", () => {
    expect(ferryMapLine(ferryFixture({ status: "cancelled" }))?.kind).toBe("straight");
  });
});

describe("FerryRouteMap", () => {
  beforeEach(() => buildLayers.mockClear());

  it("builds the dashboard's ferry layers and captions the sea route", () => {
    const ride = ferryFixture({ geometry: SEA, geometrySource: "sea_route" });
    render(<FerryRouteMap ride={ride} />);
    expect(screen.getByTestId("ferry-route-map")).toBeInTheDocument();
    expect(screen.getByTestId("ferry-line-source").textContent).toBe("ferry:map.line.seaRoute");
    const [rides, color, , , , domain] = buildLayers.mock.calls[0];
    expect(rides).toEqual([expect.objectContaining({ id: ride.id, geometry: SEA })]);
    expect([color, domain]).toEqual(["#5686b8", "ferry"]);
  });

  it("says a chord is a straight line, not the ship's way", () => {
    render(<FerryRouteMap ride={ferryFixture({ geometry: null })} />);
    expect(screen.getByTestId("ferry-line-source").textContent).toBe("ferry:map.line.straight");
  });
});
