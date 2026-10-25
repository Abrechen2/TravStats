import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { SharedTripRoute } from "../../../lib/api/travtrack";

/**
 * A route another member of a shared trip shares with the reader (TravTrack
 * plan T7), on the trip map: read-only lines, one layer per sharer. Its own
 * colour — neither the reader's recording (`RECORDING_RGB`) nor a domain
 * colour — and labelled with the sharer's name in the legend above the map.
 */
export const SHARED_ROUTE_RGB: [number, number, number] = [79, 70, 229];

type Line = Array<[number, number]>;

export function buildSharedRouteLayers(routes: readonly SharedTripRoute[]): Layer[] {
  return routes
    .map((route, index) => ({ index, lines: route.geometry.filter((l) => l.length >= 2) }))
    .filter((r) => r.lines.length > 0)
    .map(
      ({ index, lines }) =>
        new PathLayer<Line>({
          id: `trip-shared-route-${index}`,
          data: lines,
          getPath: (d) => d,
          getColor: [...SHARED_ROUTE_RGB, 200],
          getWidth: 3,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          pickable: false,
        })
    );
}

/** Every vertex of the shared routes, for framing the map around them. */
export function sharedRoutePoints(routes: readonly SharedTripRoute[]): Line {
  return routes.flatMap((r) => r.geometry.flat());
}
