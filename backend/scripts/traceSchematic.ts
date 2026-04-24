import { computeSchematicRoute } from "../src/services/schematicRouter";

const cases: Array<{ label: string; dep: { lat: number; lon: number }; arr: { lat: number; lon: number } }> = [
  { label: "Ravenna → Split", dep: { lat: 44.42, lon: 12.2 }, arr: { lat: 43.51, lon: 16.44 } },
  { label: "Split → Dubrovnik", dep: { lat: 43.51, lon: 16.44 }, arr: { lat: 42.64, lon: 18.09 } },
  { label: "Dubrovnik → Athens", dep: { lat: 42.64, lon: 18.09 }, arr: { lat: 37.94, lon: 23.64 } },
  { label: "Athens → Santorini", dep: { lat: 37.94, lon: 23.64 }, arr: { lat: 36.39, lon: 25.46 } },
  { label: "Santorini → Ravenna", dep: { lat: 36.39, lon: 25.46 }, arr: { lat: 44.42, lon: 12.2 } },
  { label: "Hamburg → Bergen", dep: { lat: 53.55, lon: 9.97 }, arr: { lat: 60.39, lon: 5.32 } },
  { label: "Bremerhaven → Hamburg", dep: { lat: 53.55, lon: 8.57 }, arr: { lat: 53.55, lon: 9.97 } },
  { label: "Funchal → Lisbon", dep: { lat: 32.64, lon: -16.91 }, arr: { lat: 38.71, lon: -9.14 } },
  { label: "Oslo → Copenhagen", dep: { lat: 59.91, lon: 10.75 }, arr: { lat: 55.68, lon: 12.57 } },
  { label: "Bergen → Flåm", dep: { lat: 60.39, lon: 5.32 }, arr: { lat: 60.86, lon: 7.11 } },
  { label: "Skagway → Ketchikan", dep: { lat: 59.46, lon: -135.31 }, arr: { lat: 55.34, lon: -131.65 } },
  { label: "Hong Kong → Halong Bay", dep: { lat: 22.3, lon: 114.17 }, arr: { lat: 20.91, lon: 107.18 } },
  { label: "Miami → Nassau", dep: { lat: 25.77, lon: -80.19 }, arr: { lat: 25.05, lon: -77.35 } },
];

async function main(): Promise<void> {
  for (const c of cases) {
    const t0 = Date.now();
    const r = await computeSchematicRoute(c.dep, c.arr);
    const ms = Date.now() - t0;
    const points = r.waypoints
      .map(([lon, lat]) => `[${lat.toFixed(1)},${lon.toFixed(1)}]`)
      .join(" → ");
    console.log(
      `${c.label.padEnd(30)} ${r.routed ? "ROUTED" : "DIRECT"}  ${r.waypoints.length} pts  (${ms}ms)`,
    );
    console.log(`  ${points}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
