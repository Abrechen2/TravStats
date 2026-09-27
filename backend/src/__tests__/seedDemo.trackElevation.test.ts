import {
  readGeometryFile,
  TRACKS_FILE,
  type StoredTrack,
} from "../seedDemo/realistic/geometryFile";
import { climbAndDescent } from "../services/tour/tracks/trackMetrics";

/**
 * The demo's recordings are read by their climb. A 90 m DEM beside the Mosel
 * is half valley wall, and the raw samples made the river cycle path climb
 * 6,283 m in four days (acceptance run, 2026-09-26). The generator now runs a
 * median over them (`scripts/demo/generateDemoGeometry.ts`); these bounds are
 * what a reader would still believe.
 */
describe("demo recordings climb what their ground climbs", () => {
  const tracks = readGeometryFile<StoredTrack>(TRACKS_FILE);
  const ascent = (key: string): number => climbAndDescent(tracks[key].e)?.ascentM ?? NaN;

  it("the Mosel cycle path, Trier to Koblenz, climbs little", () => {
    const total = ["mosel-1", "mosel-2", "mosel-3", "mosel-4"].reduce((s, k) => s + ascent(k), 0);
    expect(total).toBeLessThan(1200);
  });

  it("a mountain day keeps its mountain", () => {
    expect(ascent("av1-1")).toBeGreaterThan(700);
    expect(ascent("av1-3")).toBeGreaterThan(800);
  });
});
