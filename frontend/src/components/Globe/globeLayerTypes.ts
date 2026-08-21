// Shared data shapes for the globe deck.gl layers. Lives outside
// GlobeView so the layer factory and the React component can both
// reference them without import cycles.

import type { Quartile } from "./heatmapUtils";
import type { Rgb } from "../../lib/cruiseColor";
import type { CruiseStatus } from "../../types/cruise";

export interface ArcDatum {
  from: [number, number];
  to: [number, number];
  /**
   * Pre-tessellated great-circle path with parabolic z-altitude in
   * meters; first/last entries == [from, 0] / [to, 0]. The radial
   * altitude makes the path bow outward from the sphere on globe
   * projection, restoring the 3D arc look.
   */
  waypoints: [number, number, number][];
  count: number;
  flightIds: string[];
  color: [number, number, number];
  quartile: Quartile;
  departure: {
    iata?: string;
    icao?: string;
    name?: string;
    city?: string | null;
    country?: string | null;
  };
  arrival: {
    iata?: string;
    icao?: string;
    name?: string;
    city?: string | null;
    country?: string | null;
  };
  /**
   * Set when at least one constituent flight had no IATA on either
   * endpoint and we fell back to coordinate-rounded identity. The arc
   * may aggregate flights that were *almost* the same route — surfaced
   * to the user via a dashed style so they don't blindly trust the
   * count.
   */
  weak: boolean;
  /**
   * Simplified two-tone status category for this aggregated route:
   * `"scheduled"` only when EVERY constituent flight is still scheduled
   * (pure-scheduled, never flown); `"past"` otherwise — this collapses
   * historical-only, mixed (flown + scheduled), and regular past-only
   * routes into one bucket, mirroring the flat map's `routesLayer.ts`
   * `pureScheduled` rule. Consumed by `buildGlobeLayers`'s
   * `resolveFlightArcColor` → the shared `resolveFlightColor`.
   */
  status: "past" | "scheduled";
  /**
   * Status-aware split of `count` — flown/historical vs. scheduled. `count`
   * itself keeps its all-statuses meaning; these two are additive
   * breakdowns for the hover tooltip so a planned flight is never presented
   * as flown (mirrors routesLayer.ts's RouteRecord / ArcDatum).
   */
  flownCount: number;
  scheduledCount: number;
}

export interface PointDatum {
  position: [number, number];
  size: number;
  iata: string;
  name: string;
  /** ICAO code (airports only) — shown alongside the IATA in the pinned card. */
  icao?: string;
  /** City the airport/port serves — shown as "City, Country" in overlays. */
  city?: string | null;
  /** Display label for the on-map pill. Airports leave this unset and
   *  fall back to `iata`; ports set it to the readable port name (see
   *  `toPortLabel`) so the overlay never shows a raw UN/LOCODE. */
  label?: string;
  /** ISO 3166-1 alpha-2 country code — drives the overlay flag. Airports
   *  from /geo enrichment; ports from the UN/LOCODE prefix. */
  country?: string;
  /** ISO date of the most recent flight or cruise stop touching this
   *  marker; surfaced in the hover tooltip. Undefined when no dated
   *  events exist for this marker (extremely rare — would mean every
   *  contributing flight had no `departureTime`). */
  lastVisit?: string;
}

export interface CruisePathDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLabel: string;
  status: CruiseStatus;
  /**
   * Pre-resolved tint for this leg — `"status"` mode: blue (past)
   * or cyan ("planned", scheduled); `"perCruise"` mode: a
   * distinct hue via `resolveCruiseColor`. Resolved once per cruise in
   * `GlobeView`'s `cruisePaths` builder via `resolveCruiseArcColor`, the
   * same helper the flat map's `cruiseArcsLayer.ts` uses, so both
   * renderers agree pixel-for-pixel.
   */
  color: Rgb;
}

export interface TooltipState {
  html: string;
  x: number;
  y: number;
}

// `anchorLngLat` is where the popup tail points on the globe surface:
// - airport/port: the marker's own [lng, lat]
// - arc/cruise: PickingInfo.coordinate from the click event, so the
//   popup attaches to where the user actually tapped the line, not to
//   an aggregated midpoint
export type GlobePinned =
  | { kind: "arc"; data: ArcDatum; anchorLngLat: [number, number] }
  | { kind: "airport"; data: PointDatum; anchorLngLat: [number, number] }
  | { kind: "port"; data: PointDatum; anchorLngLat: [number, number] }
  | { kind: "cruise"; data: CruisePathDatum; anchorLngLat: [number, number] };
