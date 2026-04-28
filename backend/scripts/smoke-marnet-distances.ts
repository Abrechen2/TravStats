/**
 * Smoke check: print haversine-vs-marnet distances for known cruise
 * legs. Run with `npx tsx scripts/smoke-marnet-distances.ts` from the
 * backend directory.
 *
 * Sanity targets (rough, from public cruise itineraries / port-to-port
 * resources — not authoritative):
 *   Hamburg → New York            ~6 200 km
 *   Miami → Cozumel               ~840 km
 *   Civitavecchia → Barcelona     ~860 km
 *   Sydney → Auckland             ~2 150 km
 *   Singapore → Hong Kong         ~2 600 km
 *
 * Marnet should land within ±5–10 % of these. Haversine often
 * underestimates by 5–25 % because it cuts straight through land.
 */

import { computeLegDistance } from "../src/services/cruiseDistance";
import { haversineKm } from "../src/shared/geo/haversine";
import type { PortPoint } from "../src/services/cruiseDistance/types";

const PORTS: Record<string, PortPoint> = {
  HAM: { id: 1, lat: 53.55, lon: 9.99, unlocode: "DEHAM", region: "atlantic" },
  NYC: { id: 2, lat: 40.7, lon: -74.0, unlocode: "USNYC", region: "atlantic" },
  MIA: { id: 3, lat: 25.77, lon: -80.19, unlocode: "USMIA", region: "caribbean" },
  CZM: { id: 4, lat: 20.51, lon: -86.95, unlocode: "MXCZM", region: "caribbean" },
  CIV: { id: 5, lat: 42.09, lon: 11.79, unlocode: "ITCVV", region: "mediterranean" },
  BCN: { id: 6, lat: 41.34, lon: 2.16, unlocode: "ESBCN", region: "mediterranean" },
  SYD: { id: 7, lat: -33.86, lon: 151.21, unlocode: "AUSYD", region: "pacific" },
  AKL: { id: 8, lat: -36.84, lon: 174.76, unlocode: "NZAKL", region: "pacific" },
  SIN: { id: 9, lat: 1.27, lon: 103.85, unlocode: "SGSIN", region: "asia" },
  HKG: { id: 10, lat: 22.32, lon: 114.17, unlocode: "HKHKG", region: "asia" },
  // Transit-required routes — these should beat haversine clearly
  TYO: { id: 11, lat: 35.65, lon: 139.78, unlocode: "JPTYO", region: "asia" },
  CPT: { id: 12, lat: -33.92, lon: 18.42, unlocode: "ZACPT", region: "africa" },
  BUE: { id: 13, lat: -34.6, lon: -58.38, unlocode: "ARBUE", region: "atlantic" },
  VLP: { id: 14, lat: -33.04, lon: -71.62, unlocode: "CLVAP", region: "pacific" },
};

const LEGS: Array<[keyof typeof PORTS, keyof typeof PORTS, number]> = [
  // Open-ocean direct (haversine should win)
  ["HAM", "NYC", 6200],
  ["MIA", "CZM", 840],
  ["CIV", "BCN", 860],
  ["SYD", "AKL", 2150],
  ["SIN", "HKG", 2600],
  // Transit-required (marnet should clearly beat haversine)
  ["HAM", "TYO", 21000], // via Suez
  ["HAM", "CPT", 11900], // around West Africa
  ["BUE", "VLP", 4200], // Magellan/Drake — haversine cuts through Argentina
];

async function main(): Promise<void> {
  process.env.NODE_ENV = "production";
  console.log(
    "leg                 | haversine | marnet   | reference | Δ-marnet",
  );
  console.log(
    "--------------------+-----------+----------+-----------+---------",
  );
  for (const [a, b, ref] of LEGS) {
    const from = PORTS[a];
    const to = PORTS[b];
    const hav = haversineKm({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon });
    const result = await computeLegDistance(from, to);
    const delta = ((result.distanceKm - ref) / ref) * 100;
    console.log(
      `${a} → ${b}            | ${hav.toFixed(0).padStart(7)} | ${result.distanceKm
        .toFixed(0)
        .padStart(7)} (${result.method}, ${result.confidence}) | ${ref.toString().padStart(7)} | ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
