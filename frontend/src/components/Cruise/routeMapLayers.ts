import { PathLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import type { Cruise } from "../../types";
import type { CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { createCruiseArcsLayer, createCruiseArrowsLayer } from "../layers/cruiseArcsLayer";
import { createCruisePortsLayer } from "../layers/cruisePortsLayer";
import { DEFAULT_CRUISE_COLORS, type CruiseColorConfig } from "../../lib/cruiseColor";
import type { LonLat, RouteEditorState } from "./routeEditorState";

/** The detail map shows ONE cruise — always in that cruise's own hue. */
const DETAIL_MAP_COLOR_CONFIG: CruiseColorConfig = {
  mode: "perCruise",
  colors: DEFAULT_CRUISE_COLORS,
};

export interface CruiseRouteLayerInputs {
  cruise: Cruise;
  geometryMap: Parameters<typeof createCruiseArcsLayer>[1];
  zoom: number;
  /** A leg is open in the editor. */
  hasEditingLeg: boolean;
  editorState: RouteEditorState | null;
  onEditorInsert: (segmentIndex: number, at: LonLat) => void;
  clickBelongsToAnotherLeg: (x: number, y: number) => boolean;
}

/** Arcs, arrows and port pins of the cruise, plus the editor's segment guide. */
export function buildCruiseRouteLayers({
  cruise,
  geometryMap,
  zoom,
  hasEditingLeg,
  editorState,
  onEditorInsert,
  clickBelongsToAnotherLeg,
}: CruiseRouteLayerInputs): Layer[] {
  // The cruise DETAIL map, not a dashboard view: it shows exactly one cruise,
  // so it always paints that cruise's own hue. It has no control panel and
  // deliberately does not follow the dashboard's cruise colour mode — a
  // per-cruise page showing the cruise's own colour needs no user setting.
  const arcsLayer = createCruiseArcsLayer([cruise], geometryMap, null, undefined, {
    zoom,
    colorConfig: DETAIL_MAP_COLOR_CONFIG,
  });
  const arrowsLayer = createCruiseArrowsLayer([cruise], geometryMap, null, {
    zoom,
    colorConfig: DETAIL_MAP_COLOR_CONFIG,
  });
  // Detail map for ONE cruise, possibly still just booked — it must show
  // every stop as a pin regardless of status. The default "visits" scope
  // drops every stop of a scheduled/in-progress/cancelled cruise, so the
  // layer would return null and the itinerary preview would stay blank.
  const portsLayers = createCruisePortsLayer([cruise], zoom, { scope: "itinerary" });

  // The straight guide between handles, one path per segment so a click
  // resolves directly to the segment index insertWaypoint wants. The
  // drawn route is a spline THROUGH the handles and bows away from this
  // straight line — without the guide, a click on the curve could not say
  // which two handles it belongs between.
  const guideLayer =
    hasEditingLeg && editorState
      ? new PathLayer<{ path: LonLat[]; segment: number }>({
          id: "route-editor-guide",
          data: editorState.waypoints.slice(0, -1).map((p, i) => ({
            path: [p, editorState.waypoints[i + 1]],
            segment: i,
          })),
          getPath: (d) => d.path,
          getColor: [168, 19, 90, 140],
          getWidth: 2,
          widthUnits: "pixels",
          pickable: true,
          // One path per segment is the point: deck.gl hands back the
          // index of the datum that was clicked, which IS the segment
          // index the state reducer wants. Hit-testing a single
          // multi-segment path would not tell us which stretch was hit.
          onClick: (info: PickingInfo<{ path: LonLat[]; segment: number }>): boolean => {
            if (info.index >= 0 && info.coordinate) {
              // Defer when the user was aiming at a different leg: returning
              // false lets the pick fall through to the root handler, which
              // switches. Swallowing it here is what silently edited the
              // wrong leg.
              if (clickBelongsToAnotherLeg(info.x, info.y)) return false;
              onEditorInsert(info.index, [info.coordinate[0], info.coordinate[1]]);
              return true;
            }
            return false;
          },
        })
      : null;

  return [
    ...(arcsLayer !== null ? [arcsLayer] : []),
    ...(arrowsLayer !== null ? [arrowsLayer] : []),
    ...(portsLayers ?? []),
    ...(guideLayer !== null ? [guideLayer] : []),
  ];
}

/** Every point the initial fit must contain: ports first, then the drawn route. */
export function cruiseBboxPoints(
  cruise: Cruise,
  geometry: CruiseRouteFeatureCollection | null
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  if (cruise.departurePort) pts.push([cruise.departurePort.lon, cruise.departurePort.lat]);
  if (cruise.arrivalPort) pts.push([cruise.arrivalPort.lon, cruise.arrivalPort.lat]);
  for (const stop of cruise.stops) {
    if (stop.port) pts.push([stop.port.lon, stop.port.lat]);
  }
  if (geometry) {
    for (const feat of geometry.features) {
      for (const c of feat.geometry.coordinates) pts.push(c);
    }
  }
  return pts;
}
