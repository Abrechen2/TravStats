import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Layer } from "@deck.gl/core";
import { greatCirclePath } from "./greatCircle";
import {
  STATION_DOT_OUTLINE_PX,
  STATION_DOT_OUTLINE_RGBA,
  STATION_DOT_RADIUS_PX,
} from "./markerDotStyle";
import type { Rgb } from "../../lib/domainColor";
import type { RentalBooking } from "../../types/rental";

/**
 * Rentals on the map (spec 2026-10-01-rental-domain-design §6, D1 a; concept
 * page 2026-10-01). A rental knows two places and no route:
 *
 * - returned where it was picked up: ONE point, drawn as the plain station dot
 *   every line domain uses (`STATION_DOT_*` in markerDotStyle.ts — a rail
 *   station looks the same), in the rental colour (forgejo#208). It used to be
 *   a 7 px ring around a translucent dot, a mark no other domain draws;
 * - one-way: two points — the pickup hollow, the return filled — joined by a
 *   DASHED line that says "from here to there", never "this was driven";
 * - attached to a roadtrip: the roadtrip draws its own real line; the rental
 *   adds only its two points as badges at the ends, and no line of its own.
 *
 * A cancelled rental never happened and draws nothing. The colour is never
 * decided here: the caller passes the one it resolved from the domain colour
 * store, so the layer and the legend cannot disagree.
 */

export type RentalMapSource = Pick<
  RentalBooking,
  | "id"
  | "provider"
  | "pickupStationName"
  | "returnStationName"
  | "pickupLat"
  | "pickupLon"
  | "returnLat"
  | "returnLon"
  | "oneWay"
  | "routeId"
  | "status"
>;

export type RentalPointRole = "same" | "pickup" | "return";

export interface RentalPointDatum {
  key: string;
  position: [number, number];
  role: RentalPointRole;
  label: string;
}

export interface RentalLinkDatum {
  id: string;
  path: Array<[number, number]>;
  label: string;
}

export const RENTAL_GLOBE_ALTITUDE_M = 5_000;

export function buildRentalPoints(rentals: readonly RentalMapSource[]): RentalPointDatum[] {
  const points: RentalPointDatum[] = [];
  for (const r of rentals) {
    if (r.status === "cancelled") continue;
    if (!r.oneWay) {
      points.push({
        key: `${r.id}-same`,
        position: [r.pickupLon, r.pickupLat],
        role: "same",
        label: `${r.provider} · ${r.pickupStationName}`,
      });
      continue;
    }
    points.push(
      {
        key: `${r.id}-pickup`,
        position: [r.pickupLon, r.pickupLat],
        role: "pickup",
        label: `${r.provider} · ${r.pickupStationName}`,
      },
      {
        key: `${r.id}-return`,
        position: [r.returnLon, r.returnLat],
        role: "return",
        label: `${r.provider} · ${r.returnStationName}`,
      }
    );
  }
  return points;
}

/** The dashed link of a one-way rental — none for a rental a roadtrip already draws. */
export function buildRentalLinks(rentals: readonly RentalMapSource[]): RentalLinkDatum[] {
  return rentals
    .filter((r) => r.status !== "cancelled" && r.oneWay && r.routeId === null)
    .map((r) => ({
      id: r.id,
      path: greatCirclePath([r.pickupLon, r.pickupLat], [r.returnLon, r.returnLat]).points as Array<
        [number, number]
      >,
      label: `${r.pickupStationName} → ${r.returnStationName}`,
    }));
}

export interface RentalLayerOptions {
  color: Rgb;
  altitudeM?: number;
  idPrefix?: string;
  /** The user's link-width multiplier (map panel, forgejo#198). 1 = default. */
  widthScale?: number;
  /** The user's station-marker multiplier. 1 = default, 0 = no markers. */
  markerSize?: number;
}

/** Default pixel sizes: the link's width and the two marker radii. */
export const RENTAL_LINK_WIDTH_PX = 2;
export const RENTAL_RADIUS_PX = { same: STATION_DOT_RADIUS_PX, end: 5 } as const;
/** The ring width of a one-way rental's two ends. */
const RENTAL_END_RING_PX = 2;

const lift =
  (altitudeM: number) =>
  (p: [number, number]): [number, number] | [number, number, number] =>
    altitudeM === 0 ? p : [p[0], p[1], altitudeM];

/** The dash of a one-way link: long enough to read as a line, broken enough to read as "not a route". */
export const RENTAL_LINK_DASH: [number, number] = [6, 5];

export function buildRentalDeckLayers(
  points: readonly RentalPointDatum[],
  links: readonly RentalLinkDatum[],
  { color, altitudeM = 0, idPrefix = "rental", widthScale = 1, markerSize = 1 }: RentalLayerOptions
): Layer[] {
  const at = lift(altitudeM);
  const linkLayer = new PathLayer<RentalLinkDatum, PathStyleExtensionProps<RentalLinkDatum>>({
    id: `${idPrefix}-links`,
    data: links as RentalLinkDatum[],
    getPath: (d) => d.path.map(at),
    getColor: [...color, 200],
    getWidth: RENTAL_LINK_WIDTH_PX * widthScale,
    widthUnits: "pixels",
    extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true })],
    getDashArray: RENTAL_LINK_DASH,
    dashJustified: true,
    pickable: true,
  });
  // Size 0 is the slider's "Aus": no marker layer at all, not 0 px rings.
  if (markerSize <= 0) return [linkLayer];
  // A same-station rental is the plain station dot: opaque fill, thin dark
  // outline. A one-way rental's ends keep their own mark, a ring in the rental
  // colour — hollow at the pickup, filled at the return — because hollow and
  // filled are what say which way the car went.
  const pointLayer = new ScatterplotLayer<RentalPointDatum>({
    id: `${idPrefix}-points`,
    data: points as RentalPointDatum[],
    getPosition: (d) => at(d.position),
    getRadius: (d) =>
      (d.role === "same" ? RENTAL_RADIUS_PX.same : RENTAL_RADIUS_PX.end) * markerSize,
    radiusUnits: "pixels",
    stroked: true,
    filled: true,
    lineWidthUnits: "pixels",
    getLineWidth: (d) => (d.role === "same" ? STATION_DOT_OUTLINE_PX : RENTAL_END_RING_PX),
    getLineColor: (d) => (d.role === "same" ? STATION_DOT_OUTLINE_RGBA : [...color, 255]),
    getFillColor: (d) => (d.role === "pickup" ? [0, 0, 0, 0] : [...color, 255]),
    pickable: true,
    updateTriggers: { getRadius: markerSize, getLineColor: color, getFillColor: color },
  });
  return [linkLayer, pointLayer];
}
