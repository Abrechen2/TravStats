/** `[longitude, latitude]`, the order deck.gl and MapLibre both read. */
export type LngLat = [number, number];

/** The places a trip map draws, as far as framing the trip is concerned. */
export interface TripBoundsSources {
  flightArcs: readonly { source: LngLat; target: LngLat }[];
  cruisePaths: readonly { path: readonly LngLat[] }[];
  stopPoints: readonly { position: LngLat }[];
  lodgings: readonly { lat?: number | null; lon?: number | null }[];
  tourPaths: readonly { path: readonly LngLat[] }[];
  /**
   * Whatever the caller draws through `extraLayers` — the trip's bus rides —
   * as the points it covers. A layer that adds lines to the map but not its
   * points to this list is drawn where the camera never looks, and a trip made
   * only of such lines gets the "no geo data" notice on top of them (found on
   * the 2.7.0-beta.20 beta: three bus rides in Korea, a map centred on the
   * Atlantic and the empty-trip message).
   */
  extraPoints: readonly LngLat[];
}

/**
 * Every point the camera must frame — and, when there is none, the reason the
 * map says the trip has no geo data. One list for both, so what is drawn and
 * what counts as "something to show" cannot disagree.
 */
export function tripBoundsPoints(sources: TripBoundsSources): LngLat[] {
  const pts: LngLat[] = [];
  for (const a of sources.flightArcs) pts.push(a.source, a.target);
  for (const p of sources.cruisePaths) for (const c of p.path) pts.push(c);
  for (const s of sources.stopPoints) pts.push(s.position);
  // Hotels count towards the fit too. A round trip whose flights all land in
  // one capital would otherwise open zoomed on the airport while the twelve
  // houses it actually visited sit outside the frame.
  for (const l of sources.lodgings) {
    if (l.lat != null && l.lon != null) pts.push([l.lon, l.lat]);
  }
  // Tour lines too: a day tour may be nothing but its recording (2.7).
  for (const p of sources.tourPaths) for (const c of p.path) pts.push(c);
  for (const c of sources.extraPoints) pts.push(c);
  return pts;
}
