// Shared data shapes for the globe deck.gl layers. Lives outside
// GlobeView so the layer factory and the React component can both
// reference them without import cycles.

import type { Quartile } from "./heatmapUtils";

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
  departure: { iata?: string; name?: string };
  arrival: { iata?: string; name?: string };
  /**
   * Set when at least one constituent flight had no IATA on either
   * endpoint and we fell back to coordinate-rounded identity. The arc
   * may aggregate flights that were *almost* the same route — surfaced
   * to the user via a dashed style so they don't blindly trust the
   * count.
   */
  weak: boolean;
}

export interface PointDatum {
  position: [number, number];
  size: number;
  iata: string;
  name: string;
}

export interface CruisePathDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLabel: string;
}

export interface TooltipState {
  html: string;
  x: number;
  y: number;
}

export type GlobePinned =
  | { kind: "arc"; data: ArcDatum }
  | { kind: "airport"; data: PointDatum }
  | { kind: "port"; data: PointDatum }
  | { kind: "cruise"; data: CruisePathDatum };
