import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Layer } from "@deck.gl/core";
import { greatCirclePath } from "./greatCircle";
import type { Rgb } from "../../lib/domainColor";
import type { RentalBooking } from "../../types/rental";

/**
 * Rentals on the map (spec 2026-10-01-rental-domain-design §6, D1 a; concept
 * page 2026-10-01). A rental knows two places and no route:
 *
 * - returned where it was picked up: ONE point, drawn as a ring around a dot;
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
}

const lift =
  (altitudeM: number) =>
  (p: [number, number]): [number, number] | [number, number, number] =>
    altitudeM === 0 ? p : [p[0], p[1], altitudeM];

/** The dash of a one-way link: long enough to read as a line, broken enough to read as "not a route". */
export const RENTAL_LINK_DASH: [number, number] = [6, 5];

export function buildRentalDeckLayers(
  points: readonly RentalPointDatum[],
  links: readonly RentalLinkDatum[],
  { color, altitudeM = 0, idPrefix = "rental" }: RentalLayerOptions
): Layer[] {
  const at = lift(altitudeM);
  const linkLayer = new PathLayer<RentalLinkDatum, PathStyleExtensionProps<RentalLinkDatum>>({
    id: `${idPrefix}-links`,
    data: links as RentalLinkDatum[],
    getPath: (d) => d.path.map(at),
    getColor: [...color, 200],
    getWidth: 2,
    widthUnits: "pixels",
    extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true })],
    getDashArray: RENTAL_LINK_DASH,
    dashJustified: true,
    pickable: true,
  });
  // The ring: every point carries it. Pickup is hollow (ring only), return and
  // a same-station rental are filled — a same-station point is ring + dot.
  const pointLayer = new ScatterplotLayer<RentalPointDatum>({
    id: `${idPrefix}-points`,
    data: points as RentalPointDatum[],
    getPosition: (d) => at(d.position),
    getRadius: (d) => (d.role === "same" ? 7 : 5),
    radiusUnits: "pixels",
    stroked: true,
    filled: true,
    lineWidthUnits: "pixels",
    getLineWidth: 2,
    getLineColor: [...color, 255],
    getFillColor: (d) =>
      d.role === "pickup" ? [0, 0, 0, 0] : [...color, d.role === "same" ? 110 : 255],
    pickable: true,
  });
  return [linkLayer, pointLayer];
}
