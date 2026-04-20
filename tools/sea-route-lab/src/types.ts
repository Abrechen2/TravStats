export type LonLat = [number, number];

export interface Port {
  name: string;
  lat: number;
  lon: number;
}

export interface PortPair {
  id: string;
  label: string;
  from: Port;
  to: Port;
}

export interface RouteResult {
  /** `[lon, lat]` polyline. Always ≥ 2 points; caller decides how to render. */
  coordinates: LonLat[];
  /** Great-circle length of the polyline in kilometres. */
  distanceKm: number;
  /** Wall-clock time the method needed to produce `coordinates`, in ms. */
  computeMs: number;
  /** Free-form note the method can surface ("fallback", "snapped to water", …). */
  note?: string;
}

export interface RouteMethod {
  id: string;
  label: string;
  /** CSS hex colour used both for the polyline and the chip in the sidebar. */
  color: string;
  /** Short blurb shown under the method name — how the method works. */
  description: string;
  /** Whether the method is on by default when the page loads. */
  defaultOn: boolean;
  compute: (pair: PortPair) => Promise<RouteResult>;
}
