import { describe, it, expect, vi } from "vitest";
import { PathLayer } from "@deck.gl/layers";
import {
  ARC_ALTITUDE_FRACTION,
  ARC_BASE_OFFSET_M,
  arcBaseOffsetM,
  getArcPeakAltitudeMeters,
  greatCircleWaypoints,
} from "../arcUtils";
import { buildGlobeLayers, type BuildGlobeLayersOptions } from "../buildGlobeLayers";
import { EarthOcclusionExtension } from "../EarthOcclusionExtension";
import type { ArcDatum } from "../globeLayerTypes";

/**
 * forgejo#331: arcs are the only thing still drawn above the ground, lowered
 * from 12 % to 4 % of the distance, with their ends a few km up instead of on
 * the globe mesh.
 */

describe("flight arc height", () => {
  it("bows to 4 % of the distance, not the 12 % it was", () => {
    expect(ARC_ALTITUDE_FRACTION).toBe(0.04);
    expect(getArcPeakAltitudeMeters(8_000)).toBeCloseTo(320_000, 0);
  });

  it("starts and ends a base offset above the ground and peaks in the middle", () => {
    const path = greatCircleWaypoints([8, 50], [-74, 40], 300_000, 20, ARC_BASE_OFFSET_M);
    expect(path[0][2]).toBe(ARC_BASE_OFFSET_M);
    expect(path[path.length - 1][2]).toBeCloseTo(ARC_BASE_OFFSET_M, 6);
    expect(Math.max(...path.map((p) => p[2]))).toBeCloseTo(ARC_BASE_OFFSET_M + 300_000, -2);
  });

  it("keeps the journey and trip maps' arcs on the surface unless a caller asks for an offset", () => {
    const path = greatCircleWaypoints([8, 50], [-74, 40], 300_000, 20);
    expect(path[0][2]).toBe(0);
  });

  it("takes the base offset as a parameter, for city zoom", () => {
    const path = greatCircleWaypoints([8, 50], [9, 51], 1_000, 8, 120);
    expect(path[0][2]).toBe(120);
  });

  it("shrinks the base offset as the camera comes in, so an arc end does not hang over its airport", () => {
    expect(arcBaseOffsetM(1.6)).toBe(ARC_BASE_OFFSET_M);
    expect(arcBaseOffsetM(4)).toBe(ARC_BASE_OFFSET_M);
    expect(arcBaseOffsetM(8)).toBe(ARC_BASE_OFFSET_M / 16);
    // 3 km at zoom 12.5 is hundreds of pixels; the floor keeps it to a few.
    expect(arcBaseOffsetM(12.5)).toBe(100);
    expect(arcBaseOffsetM(20)).toBe(100);
  });
});

describe("buildGlobeLayers: deck.gl draws arcs and nothing else", () => {
  const arc = {
    from: [8, 50],
    to: [-74, 40],
    waypoints: [
      [8, 50, 3000],
      [-74, 40, 3000],
    ],
    count: 1,
    quartile: 1,
    status: "past",
    departure: {},
    arrival: {},
  } as unknown as ArcDatum;

  function opts(over: Partial<BuildGlobeLayersOptions> = {}): BuildGlobeLayersOptions {
    return {
      arcsData: [arc],
      antipodalArcs: [arc],
      headFlightArc: null,
      activeQuartile: null,
      lite: false,
      occlusionExt: new EarthOcclusionExtension(),
      occlusionProps: { earthOcclusionEnabled: true, earthOcclusionFadeBand: 0.04 },
      onArcHover: vi.fn(),
      setPinned: vi.fn(),
      flightColorConfig: {
        mode: "solid",
        colors: {},
      } as unknown as BuildGlobeLayersOptions["flightColorConfig"],
      arcWidthScale: 1,
      ...over,
    };
  }

  it("builds only the flight-arc layers — no dots, no cruise paths, no night shade", () => {
    expect(buildGlobeLayers(opts()).map((l) => l.id)).toEqual([
      "globe-flight-arcs",
      "globe-flight-arcs-antipodal",
    ]);
  });

  it("pins an arc on click, anchored where it was clicked", () => {
    const setPinned = vi.fn();
    const layer = buildGlobeLayers(opts({ setPinned }))[0] as PathLayer<ArcDatum>;
    const onClick = layer.props.onClick as (i: unknown) => void;
    onClick({ object: arc, coordinate: [-30, 45], x: 5, y: 5 });
    expect(setPinned).toHaveBeenCalledWith({ kind: "arc", data: arc, anchorLngLat: [-30, 45] });
  });

  it("leaves a click and a hover to a native dot that lies under the same pixel", () => {
    const setPinned = vi.fn();
    const onArcHover = vi.fn();
    const layer = buildGlobeLayers(
      opts({ setPinned, onArcHover, isOverNative: () => true })
    )[0] as PathLayer<ArcDatum>;
    (layer.props.onClick as (i: unknown) => void)({ object: arc, x: 5, y: 5 });
    (layer.props.onHover as (i: unknown) => void)({ object: arc, x: 5, y: 5 });
    expect(setPinned).not.toHaveBeenCalled();
    expect(onArcHover).not.toHaveBeenCalled();
  });

  it("still answers a hover over an arc where no native feature is", () => {
    const onArcHover = vi.fn();
    const layer = buildGlobeLayers(
      opts({ onArcHover, isOverNative: () => false })
    )[0] as PathLayer<ArcDatum>;
    (layer.props.onHover as (i: unknown) => void)({ object: arc, x: 5, y: 5 });
    expect(onArcHover).toHaveBeenCalledTimes(1);
  });
});
