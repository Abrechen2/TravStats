/**
 * Canal + strait overrides for the A* sea-router.
 *
 * The 0.1° Natural Earth land mask correctly shows water everywhere
 * the ocean is wide enough, but misses narrow man-made canals and a
 * few natural straits where land cells on either side join up across
 * the 11-km raster cell. Without overrides, A* would route a Panama
 * crossing around Cape Horn.
 *
 * Each override is a rectangular chain of grid cells (`(lat, lon)`
 * corners, inclusive) that the router treats as water even when the
 * raster says land. The chains are drawn to follow the real canal /
 * strait axis at roughly 0.1° resolution — enough for A* to find
 * a path, not cartography-perfect.
 *
 * Wired in Phase 2 of the sea-routing plan. Phase 1 just exports
 * the list so the data is already under test when we flip the switch.
 *
 * Sources (all Wikipedia, coordinates verified 2026-04-20):
 *   https://en.wikipedia.org/wiki/Suez_Canal
 *   https://en.wikipedia.org/wiki/Panama_Canal
 *   https://en.wikipedia.org/wiki/Kiel_Canal
 *   https://en.wikipedia.org/wiki/Corinth_Canal
 *   https://en.wikipedia.org/wiki/Bosphorus
 *   https://en.wikipedia.org/wiki/Dardanelles
 *   https://en.wikipedia.org/wiki/Bab-el-Mandeb
 *   https://en.wikipedia.org/wiki/Strait_of_Hormuz
 *   https://en.wikipedia.org/wiki/Strait_of_Malacca
 *   https://en.wikipedia.org/wiki/Sunda_Strait
 *   https://en.wikipedia.org/wiki/Great_Belt
 *   https://en.wikipedia.org/wiki/Øresund
 *   https://en.wikipedia.org/wiki/Cape_Cod_Canal
 */

export interface CanalOverride {
  readonly id: string;
  /** Human-readable label; used in logs. */
  readonly name: string;
  /** Anchor coordinate (lat, lon) near one end, for documentation. */
  readonly anchor: { readonly lat: number; readonly lon: number };
  /**
   * Axis of cells to force to water, as a polyline of lat/lon pairs.
   * The router walks this polyline and forces every cell under it to
   * water before the A* run starts.
   */
  readonly axis: readonly { readonly lat: number; readonly lon: number }[];
}

/**
 * 15 canal / strait overrides covering the mainstream cruise regions.
 *
 * Coordinates below were taken from Wikipedia's infobox lat/lon for
 * each feature and extended slightly to make sure A* sees a connected
 * water path across the 0.1° grid.
 */
export const CANAL_OVERRIDES: readonly CanalOverride[] = [
  // --- Suez Canal (Mediterranean ↔ Red Sea) -----------------------------
  {
    id: 'suez',
    name: 'Suez Canal',
    anchor: { lat: 30.5852, lon: 32.2684 },
    axis: [
      { lat: 31.26, lon: 32.3 }, // Port Said
      { lat: 30.96, lon: 32.55 },
      { lat: 30.58, lon: 32.27 }, // Ismailia
      { lat: 30.02, lon: 32.55 },
      { lat: 29.93, lon: 32.58 }, // Suez
    ],
  },
  // --- Panama Canal (Atlantic → Pacific) ---------------------------------
  // Split into two overrides so the router picks up both entrances even
  // if one end of the raster is closed; axis still draws the transit.
  {
    id: 'panama_atlantic',
    name: 'Panama Canal — Atlantic entrance',
    anchor: { lat: 9.3515, lon: -79.9002 }, // Colón
    axis: [
      { lat: 9.37, lon: -79.92 },
      { lat: 9.23, lon: -79.85 },
      { lat: 9.12, lon: -79.72 }, // Gatun Lake
    ],
  },
  {
    id: 'panama_pacific',
    name: 'Panama Canal — Pacific entrance',
    anchor: { lat: 8.9333, lon: -79.5667 }, // Balboa
    axis: [
      { lat: 9.12, lon: -79.72 }, // Gatun Lake
      { lat: 9.05, lon: -79.65 },
      { lat: 8.94, lon: -79.57 },
      { lat: 8.88, lon: -79.52 }, // Pacific mouth
    ],
  },
  // --- Kiel Canal (North Sea ↔ Baltic) -----------------------------------
  {
    id: 'kiel_west',
    name: 'Kiel Canal — Brunsbüttel (west entrance)',
    anchor: { lat: 53.8905, lon: 9.1403 },
    axis: [
      { lat: 53.89, lon: 9.14 }, // Brunsbüttel
      { lat: 54.0, lon: 9.35 },
      { lat: 54.15, lon: 9.6 },
    ],
  },
  {
    id: 'kiel_east',
    name: 'Kiel Canal — Holtenau (east entrance)',
    anchor: { lat: 54.3661, lon: 10.1478 },
    axis: [
      { lat: 54.15, lon: 9.6 },
      { lat: 54.25, lon: 9.85 },
      { lat: 54.37, lon: 10.15 }, // Holtenau / Kiel Fjord
    ],
  },
  // --- Corinth Canal (Aegean ↔ Ionian) -----------------------------------
  {
    id: 'corinth',
    name: 'Corinth Canal',
    anchor: { lat: 37.9346, lon: 22.9906 },
    axis: [
      { lat: 37.95, lon: 22.97 },
      { lat: 37.93, lon: 22.99 },
      { lat: 37.91, lon: 23.01 },
    ],
  },
  // --- Bosporus (Marmara ↔ Black Sea) ------------------------------------
  {
    id: 'bosporus',
    name: 'Strait of Bosphorus',
    anchor: { lat: 41.1168, lon: 29.0691 },
    axis: [
      { lat: 40.98, lon: 28.98 }, // Marmara mouth
      { lat: 41.05, lon: 29.03 },
      { lat: 41.12, lon: 29.07 },
      { lat: 41.22, lon: 29.13 }, // Black Sea mouth
    ],
  },
  // --- Dardanelles (Aegean ↔ Marmara) ------------------------------------
  {
    id: 'dardanelles',
    name: 'Dardanelles',
    anchor: { lat: 40.2269, lon: 26.4044 },
    axis: [
      { lat: 40.06, lon: 26.19 }, // Aegean mouth
      { lat: 40.18, lon: 26.38 },
      { lat: 40.3, lon: 26.7 },
      { lat: 40.42, lon: 26.87 }, // Marmara mouth
    ],
  },
  // --- Bab-el-Mandeb (Red Sea ↔ Gulf of Aden) ----------------------------
  {
    id: 'bab_el_mandeb',
    name: 'Bab-el-Mandeb',
    anchor: { lat: 12.5822, lon: 43.3292 },
    axis: [
      { lat: 12.55, lon: 43.25 },
      { lat: 12.6, lon: 43.33 },
      { lat: 12.7, lon: 43.45 },
    ],
  },
  // --- Strait of Hormuz (Persian Gulf ↔ Gulf of Oman) --------------------
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    anchor: { lat: 26.5667, lon: 56.25 },
    axis: [
      { lat: 26.4, lon: 56.1 },
      { lat: 26.57, lon: 56.25 },
      { lat: 26.75, lon: 56.45 },
    ],
  },
  // --- Strait of Malacca (Andaman ↔ South China Sea) ---------------------
  {
    id: 'malacca',
    name: 'Strait of Malacca',
    anchor: { lat: 2.5, lon: 101.0 },
    axis: [
      { lat: 5.5, lon: 96.5 }, // northwest mouth
      { lat: 4.0, lon: 98.8 },
      { lat: 2.5, lon: 101.0 },
      { lat: 1.4, lon: 103.0 }, // Singapore Strait
    ],
  },
  // --- Sunda Strait (Java Sea ↔ Indian Ocean) ----------------------------
  {
    id: 'sunda',
    name: 'Sunda Strait',
    anchor: { lat: -6.1, lon: 105.6 },
    axis: [
      { lat: -5.7, lon: 105.3 },
      { lat: -6.1, lon: 105.6 },
      { lat: -6.5, lon: 105.85 },
    ],
  },
  // --- Great Belt (Kattegat ↔ Baltic) ------------------------------------
  {
    id: 'great_belt',
    name: 'Great Belt',
    anchor: { lat: 55.3376, lon: 10.9668 },
    axis: [
      { lat: 55.8, lon: 10.85 },
      { lat: 55.5, lon: 10.9 },
      { lat: 55.34, lon: 10.97 },
      { lat: 55.15, lon: 11.0 },
    ],
  },
  // --- Øresund (Kattegat ↔ Baltic, Malmö ↔ Copenhagen) -------------------
  {
    id: 'oresund',
    name: 'Øresund',
    anchor: { lat: 55.6, lon: 12.7 },
    axis: [
      { lat: 56.1, lon: 12.6 }, // Helsingør / Helsingborg
      { lat: 55.85, lon: 12.65 },
      { lat: 55.6, lon: 12.7 },
      { lat: 55.4, lon: 12.85 },
    ],
  },
  // --- Cape Cod Canal (Massachusetts Bay ↔ Buzzards Bay) -----------------
  {
    id: 'cape_cod',
    name: 'Cape Cod Canal',
    anchor: { lat: 41.775, lon: -70.525 },
    axis: [
      { lat: 41.78, lon: -70.6 }, // Buzzards Bay mouth
      { lat: 41.775, lon: -70.525 },
      { lat: 41.77, lon: -70.47 }, // Cape Cod Bay mouth
    ],
  },
];
