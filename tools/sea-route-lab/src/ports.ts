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
  // Codex-suggested edge cases to stress-test the Hybrid method:
  {
    id: "colon-balboa",
    label: "Colón ↔ Balboa (Panama Canal)",
    from: { name: "Colón", lat: 9.355, lon: -79.9 },
    to: { name: "Balboa", lat: 8.955, lon: -79.565 },
  },
  {
    id: "vancouver-juneau",
    label: "Vancouver ↔ Juneau (Inside Passage)",
    from: { name: "Vancouver", lat: 49.29, lon: -123.11 },
    to: { name: "Juneau", lat: 58.3019, lon: -134.4197 },
  },
  {
    id: "stockholm-helsinki",
    label: "Stockholm ↔ Helsinki (Schären)",
    from: { name: "Stockholm", lat: 59.3293, lon: 18.0686 },
    to: { name: "Helsinki", lat: 60.1699, lon: 24.9384 },
  },
];
