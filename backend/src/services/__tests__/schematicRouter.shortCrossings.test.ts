import { haversineKm, polylineLengthKm } from "../../shared/geo/haversine";
import {
  MASK1_BYTES,
  cellIndex1,
  latToRow1,
  lonToCol1,
  setBit1,
} from "../../shared/geo/landMaskGridCoarse";
import { MASK_BYTES } from "../../shared/geo/landMaskGrid";
import {
  clearSchematicRouteCache,
  computeSchematicRoute,
  loadCoarseMask,
  maxPlausibleRatio,
  setCoarseMaskForTesting,
} from "../schematicRouter";

const km = (line: [number, number][]) => polylineLengthKm(line.map(([lon, lat]) => ({ lat, lon })));

describe("sea routes of short crossings (forgejo#428)", () => {
  afterEach(() => {
    setCoarseMaskForTesting(null);
    clearSchematicRouteCache();
  });

  it("routes Amalfi -> Capri near its 33 km chord, not as a 102 km loop around Capri", async () => {
    setCoarseMaskForTesting(null);
    await loadCoarseMask(); // the real land mask
    const dep = { id: "amalfi", lat: 40.6342, lon: 14.6025 };
    const arr = { id: "capri", lat: 40.5603, lon: 14.2415 };
    const chord = haversineKm(dep, arr);
    const r = await computeSchematicRoute(dep, arr);
    expect(km(r.waypoints)).toBeLessThanOrEqual(chord * 1.3);
    expect(r.waypoints[0]).toEqual([dep.lon, dep.lat]);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual([arr.lon, arr.lat]);
  });

  it("leaves a long route that legitimately detours unchanged (Kiel -> Oslo around Denmark)", async () => {
    await loadCoarseMask();
    const dep = { id: "kiel", lat: 54.3233, lon: 10.1394 };
    const arr = { id: "oslo", lat: 59.9, lon: 10.74 };
    const chord = haversineKm(dep, arr);
    const r = await computeSchematicRoute(dep, arr);
    expect(r.routed).toBe(true);
    expect(r.method).not.toBe("local_fine");
    expect(km(r.waypoints)).toBeGreaterThan(chord * 1.1);
    expect(km(r.waypoints)).toBeLessThanOrEqual(chord * maxPlausibleRatio(chord));
  });

  it("keeps Genoa -> Venice round Italy: a high ratio alone never turns a route into a chord", async () => {
    await loadCoarseMask();
    const dep = { id: "genoa", lat: 44.4, lon: 8.93 };
    const arr = { id: "venice", lat: 45.43, lon: 12.33 };
    const chord = haversineKm(dep, arr);
    const r = await computeSchematicRoute(dep, arr);
    expect(r.routed).toBe(true);
    expect(r.method).not.toBe("direct");
    expect(km(r.waypoints)).toBeGreaterThan(chord * maxPlausibleRatio(chord));
  });

  it("widens the allowed detour with the chord", () => {
    expect(maxPlausibleRatio(33)).toBe(2);
    expect(maxPlausibleRatio(200)).toBe(3);
    expect(maxPlausibleRatio(900)).toBe(4);
    expect(MASK_BYTES).toBeGreaterThan(0);
  });
});
