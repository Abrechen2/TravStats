import { describe, it, expect } from "vitest";
import type { PathLayerProps } from "@deck.gl/layers";

import { buildTourDeckLayers, TOUR_LINE_WIDTH_PX } from "../tourMapOverlay";
import { buildTourPaths, type TourPathDatum } from "../../../layers/tourPathsLayer";
import { hexToRgb } from "../../../../lib/domainColor";
import { DOMAINS, TOUR_COLOR } from "../../../../shared/domains";
import type { TourGeometry } from "../../../../types/tour";

/**
 * Round 29 (2026-09-26, forgejo#131) gave roadtrip and day tour ONE default
 * hue. On the "Alle" map both lie side by side, so the line has to tell them
 * apart: a tour is drawn thinner. This reads the width deck.gl would be given
 * for each — the colour is the same by design, so only the width can differ.
 */
const geometry: TourGeometry = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [8, 58],
          [5.3, 60.4],
        ],
      },
      properties: {
        legId: "l1",
        source: "drawn",
        mode: "road",
        confidence: "high",
        distanceKm: 300,
      },
    },
  ],
};

function widthOf(datum: TourPathDatum): unknown {
  const [layer] = buildTourDeckLayers([datum]);
  const getWidth = (layer.props as PathLayerProps<TourPathDatum>).getWidth as (
    d: TourPathDatum
  ) => number;
  return getWidth(datum);
}

describe("a roadtrip and a day tour share a hue but not a stroke", () => {
  const [tour] = buildTourPaths([{ routeId: "t", name: "Tour", geometry }]);
  const [roadtrip] = buildTourPaths([
    {
      routeId: "r",
      name: "Roadtrip",
      geometry,
      rgb: hexToRgb(DOMAINS.roadtrip.color),
      isRoadtrip: true,
    },
  ]);

  it("paints both in the one road hue by default", () => {
    expect(tour.color).toEqual(hexToRgb(TOUR_COLOR));
    expect(roadtrip.color).toEqual(tour.color);
  });

  it("draws the tour thinner than the roadtrip", () => {
    expect(widthOf(tour)).toBe(TOUR_LINE_WIDTH_PX.tour);
    expect(widthOf(roadtrip)).toBe(TOUR_LINE_WIDTH_PX.roadtrip);
    expect(TOUR_LINE_WIDTH_PX.tour).toBeLessThan(TOUR_LINE_WIDTH_PX.roadtrip);
  });

  it("keeps a straight placeholder chord the thinnest, whatever its kind", () => {
    expect(widthOf({ ...roadtrip, isPlaceholder: true })).toBe(TOUR_LINE_WIDTH_PX.placeholder);
    expect(TOUR_LINE_WIDTH_PX.placeholder).toBeLessThan(TOUR_LINE_WIDTH_PX.tour);
  });
});
