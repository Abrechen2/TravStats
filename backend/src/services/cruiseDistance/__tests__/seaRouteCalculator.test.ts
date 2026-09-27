import { computeLegDistance } from "../index";
import { computeSchematicRoute } from "../../schematicRouter";
import { haversineKm, polylineLengthKm } from "../../../shared/geo/haversine";
import type { PortPoint } from "../types";

/**
 * Acceptance 2026-09-26, demo MSC cruise: four of seven legs were stored as
 * `haversine` ("Luftlinie", the chord) while `/geometry` drew all seven as
 * `maritime_graph` sea routes. The number and its label now come from the
 * route the map draws.
 */
const port = (id: number, name: string, unlocode: string, lat: number, lon: number): PortPoint => ({
  id,
  name,
  unlocode,
  lat,
  lon,
  region: "mediterranean",
  city: null,
  country: null,
});

const BARCELONA = port(136, "Barcelona", "ESBCN", 41.35, 2.17);
const MARSEILLE = port(34, "Marseille", "FRMRS", 43.3, 5.37);
const GENOA = port(44, "Genoa", "ITGOA", 44.41, 8.93);
const CIVITAVECCHIA = port(48, "Civitavecchia", "ITCVV", 42.09, 11.8);
const NAPLES = port(49, "Naples", "ITNAP", 40.84, 14.25);
const MESSINA = port(55, "Messina", "ITMSN", 38.1833, 15.55);
const VALLETTA = port(72, "Valletta", "MTMLA", 35.8989, 14.5142);

describe("a sea leg is measured along the route the map draws", () => {
  const env = process.env.NODE_ENV;
  // The chain keeps network routers out of the suite (they load a large
  // GeoJSON for every cruise a test creates); this test IS about them.
  beforeAll(() => {
    process.env.NODE_ENV = "development";
  });
  afterAll(() => {
    process.env.NODE_ENV = env;
  });

  it.each([
    ["Barcelona", "Marseille", BARCELONA, MARSEILLE],
    ["Genoa", "Civitavecchia", GENOA, CIVITAVECCHIA],
    ["Naples", "Messina", NAPLES, MESSINA],
    ["Valletta", "Barcelona", VALLETTA, BARCELONA],
  ])(
    "%s -> %s: a routed leg is no chord, and its kilometres are the drawn line's",
    async (_a, _b, from, to) => {
      const leg = await computeLegDistance(from, to);
      const drawn = await computeSchematicRoute(from, to);

      expect(drawn.method).toBe("maritime_graph");
      // `haversine` is what the cruise page labels "Luftlinie".
      expect(leg.method).not.toBe("haversine");
      const drawnKm = polylineLengthKm(drawn.waypoints.map(([lon, lat]) => ({ lat, lon })));
      expect(leg.distanceKm).toBeCloseTo(drawnKm, 6);
      expect(leg.distanceKm).toBeGreaterThan(haversineKm(from, to));
    },
    60_000
  );
});
