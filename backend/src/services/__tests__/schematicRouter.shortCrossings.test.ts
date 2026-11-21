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

  it("answers an absurd detour with the chord marked schematic, never as a stored route", async () => {
    // Both ports sit in the middle of a 7x7 degree block of land on the coarse
    // grid and no fine mask exists, so the only water is hundreds of km away.
    const coarse = new Uint8Array(MASK1_BYTES);
    const row0 = latToRow1(10);
    const col0 = lonToCol1(10);
    for (let r = row0 - 3; r <= row0 + 3; r++)
      for (let c = col0 - 3; c <= col0 + 3; c++) setBit1(coarse, cellIndex1(r, c), 1);
    setCoarseMaskForTesting(coarse, null);
    const dep = { id: "a", lat: 10, lon: 10 };
    const arr = { id: "b", lat: 10.2, lon: 10.2 };
    const r = await computeSchematicRoute(dep, arr);
    expect(r.routed).toBe(false);
    expect(r.method).toBe("direct");
    expect(r.waypoints).toEqual([
      [10, 10],
      [10.2, 10.2],
    ]);
  });

  it("widens the allowed detour with the chord", () => {
    expect(maxPlausibleRatio(33)).toBe(2);
    expect(maxPlausibleRatio(200)).toBe(3);
    expect(maxPlausibleRatio(900)).toBe(4);
    expect(MASK_BYTES).toBeGreaterThan(0);
  });
});
