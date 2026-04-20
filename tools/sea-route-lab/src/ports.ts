import type { PortPair } from "./types";

/**
 * Curated preset port pairs. Cover the typical cruise-map headaches:
 *  - Hamburg ↔ Copenhagen: Baltic via Øresund, plus inland-port snap
 *  - Barcelona ↔ Civitavecchia: Mediterranean, narrow straits
 *  - Miami ↔ Nassau: short Caribbean hop
 *  - Sydney ↔ Auckland: open Pacific, no coast
 *  - Hamburg ↔ New York: transatlantic, north-Atlantic
 *  - Rotterdam ↔ Singapore: global, Suez Canal + Bab-el-Mandeb + Malacca
 */
export const PORT_PAIRS: readonly PortPair[] = [
  {
    id: "hamburg-cph",
    label: "Hamburg ↔ Copenhagen",
    from: { name: "Hamburg", lat: 53.54, lon: 9.97 },
    to: { name: "Copenhagen", lat: 55.6867, lon: 12.57 },
  },
  {
    id: "barcelona-civitavecchia",
    label: "Barcelona ↔ Civitavecchia",
    from: { name: "Barcelona", lat: 41.38, lon: 2.17 },
    to: { name: "Civitavecchia", lat: 42.1, lon: 11.8 },
  },
  {
    id: "miami-nassau",
    label: "Miami ↔ Nassau",
    from: { name: "Miami", lat: 25.7745, lon: -80.19 },
    to: { name: "Nassau", lat: 25.0703, lon: -77.3483 },
  },
  {
    id: "sydney-auckland",
    label: "Sydney ↔ Auckland",
    from: { name: "Sydney", lat: -33.8688, lon: 151.2093 },
    to: { name: "Auckland", lat: -36.8485, lon: 174.7633 },
  },
  {
    id: "hamburg-nyc",
    label: "Hamburg ↔ New York",
    from: { name: "Hamburg", lat: 53.54, lon: 9.97 },
    to: { name: "New York", lat: 40.6894, lon: -74.0447 },
  },
  {
    id: "rotterdam-singapore",
    label: "Rotterdam ↔ Singapore",
    from: { name: "Rotterdam", lat: 51.9225, lon: 4.4792 },
    to: { name: "Singapore", lat: 1.265, lon: 103.82 },
  },
];
