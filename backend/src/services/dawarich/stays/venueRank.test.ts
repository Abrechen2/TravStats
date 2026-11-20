import { combineStayIdentity, type StayIdentityInput } from "./identityCombine";
import { parseVenueElements } from "./venueAreas";
import type { VenueEvidence } from "./venueRank";
import type { ImmichAsset } from "../../immich/types";
import type { PlaceResult } from "../../geo/photon";

/**
 * Name the building, not the counter inside it (TravTrack visit-detection
 * spec, rule 3). The OSM data below has the shape Overpass `out tags geom`
 * returns; the real case is a McDonald's whose McCafé counter is its own node.
 */

const centre = { lat: 52.52, lon: 13.405 };
const M_LAT = 1 / 111_320;
const M_LON = 1 / (111_320 * Math.cos((centre.lat * Math.PI) / 180));
/** A point `north`/`east` metres from the centre. */
const off = (north: number, east: number) => ({
  lat: centre.lat + north * M_LAT,
  lon: centre.lon + east * M_LON,
});

/** A closed rectangular way, Overpass `geom` shape. */
function wayBox(id: number, tags: Record<string, string>, n: number, e: number, half: number) {
  const corners = [
    off(n - half, e - half),
    off(n - half, e + half),
    off(n + half, e + half),
    off(n + half, e - half),
    off(n - half, e - half),
  ];
  return { type: "way", id, tags, geometry: corners };
}
const nodeAt = (id: number, tags: Record<string, string>, n: number, e: number) => ({
  type: "node",
  id,
  tags,
  ...off(n, e),
});

const MCD = { brand: "McDonald's", "brand:wikidata": "Q38076", operator: "Franchise GmbH" };
const evidence = (elements: object[], state: VenueEvidence["state"] = "ok"): VenueEvidence => ({
  state,
  elements: parseVenueElements({ elements }).elements,
});

const place = (
  name: string,
  ref: string,
  at: { lat: number; lon: number },
  type = "fast_food"
): PlaceResult => ({ name, externalRef: `osm:${ref}`, ...at, type, city: "Berlin" });

const counterPhoto = (at: { lat: number; lon: number }): ImmichAsset => ({
  id: "p1",
  type: "IMAGE",
  fileCreatedAt: "2026-11-01T12:00:00.000Z",
  originalFileName: "p1.jpg",
  mimeType: "image/jpeg",
  sizeBytes: null,
  ...at,
});

const input = (over: Partial<StayIdentityInput>): StayIdentityInput => ({
  point: centre,
  geocode: {
    parts: { address: "Alexanderplatz 1", city: "Berlin", country: "DE" },
    degraded: false,
  },
  places: { results: [], degraded: false },
  photos: { state: "off", assets: [], truncated: false },
  ...over,
});

describe("building recognition (rule 3)", () => {
  // The restaurant building, the McCafé counter node inside it, a bakery next door.
  const mcdBuilding = wayBox(
    1001,
    { name: "McDonald's", amenity: "fast_food", building: "yes", ...MCD },
    0,
    0,
    18
  );
  const mcCafe = nodeAt(
    2001,
    {
      name: "McCafé",
      amenity: "cafe",
      brand: "McCafé",
      "brand:wikidata": "Q38076",
      operator: "Franchise GmbH",
    },
    4,
    5
  );

  it("names the McDonald's building, not the McCafé node inside it, even with a photo at the counter", () => {
    const counter = off(4, 5);
    const view = combineStayIdentity(
      input({
        point: off(-3, -2),
        places: {
          results: [
            place("McCafé", "node/2001", counter, "cafe"),
            place("Bäckerei Schmidt", "node/2002", off(40, 40), "bakery"),
          ],
          degraded: false,
        },
        photos: { state: "ok", assets: [counterPhoto(counter)], truncated: false },
        venues: evidence([mcdBuilding, mcCafe]),
      })
    );
    expect(view.probable?.name).toBe("McDonald's");
    expect(view.venues).toEqual({ state: "ok", resolved: "contains" });
    expect(view.candidates[0]).toMatchObject({
      name: "McDonald's",
      osmRef: "way/1001",
      isArea: true,
    });
    const cafe = view.candidates.find((c) => c.name === "McCafé");
    expect(cafe).toMatchObject({ foldedInto: "McDonald's", photoCount: 1 });
  });

  it("folds the picked node into its building when the stay point is a few metres outside", () => {
    const view = combineStayIdentity(
      input({
        point: off(-24, 0), // on the car park, outside the outline
        places: { results: [place("McCafé", "node/2001", off(4, 5), "cafe")], degraded: false },
        venues: evidence([mcdBuilding, mcCafe]),
      })
    );
    expect(view.probable?.name).toBe("McDonald's");
    expect(view.venues.resolved).toBe("folded");
    expect(view.candidates.map((c) => c.name)).toEqual(["McDonald's", "McCafé"]);
  });

  it("two branches of one brand next door stay separate: the building the point is in wins", () => {
    const west = wayBox(
      1101,
      { name: "McDonald's", building: "yes", amenity: "fast_food", ...MCD },
      0,
      -60,
      15
    );
    const east = wayBox(
      1102,
      { name: "McDonald's", building: "yes", amenity: "fast_food", ...MCD },
      0,
      0,
      15
    );
    const eastCounter = nodeAt(
      2101,
      { name: "McCafé", brand: "McCafé", "brand:wikidata": "Q38076" },
      2,
      2
    );
    const view = combineStayIdentity(
      input({
        point: off(0, -58),
        places: {
          results: [
            place("McCafé", "node/2101", off(2, 2), "cafe"),
            place("McDonald's", "way/1101", off(0, -60)),
          ],
          degraded: false,
        },
        venues: evidence([west, east, eastCounter]),
      })
    );
    expect(view.probable?.name).toBe("McDonald's");
    expect(view.candidates[0].osmRef).toBe("way/1101");
    // The east branch's counter folds into the EAST building, never the west one.
    const counter = view.candidates.find((c) => c.osmRef === "node/2101");
    expect(counter?.foldedInto).toBe("McDonald's");
    expect(view.candidates.filter((c) => c.isArea).map((c) => c.osmRef)).toEqual(["way/1101"]);
  });

  it("a shared brand alone does not merge a node outside the building", () => {
    const view = combineStayIdentity(
      input({
        point: off(60, 0),
        places: { results: [place("McCafé", "node/2001", off(62, 0), "cafe")], degraded: false },
        venues: evidence([mcdBuilding, { ...mcCafe, lat: off(62, 0).lat, lon: off(62, 0).lon }]),
      })
    );
    expect(view.probable?.name).toBe("McCafé");
    expect(view.candidates[0].foldedInto).toBeFalsy();
    expect(view.venues.resolved).toBeNull();
  });

  describe("mall and shop", () => {
    const mall = wayBox(
      3001,
      { name: "Alexa", shop: "mall", building: "retail", operator: "Union Investment" },
      0,
      0,
      80
    );
    const shopNode = nodeAt(3101, { name: "Zara", shop: "clothes", brand: "Zara" }, 10, 10);

    it("a shop with a building part of its own stays the shop", () => {
      const part = wayBox(
        3201,
        { name: "Zara", shop: "clothes", "building:part": "yes", brand: "Zara" },
        10,
        10,
        12
      );
      const view = combineStayIdentity(
        input({
          point: off(10, 10),
          places: {
            results: [place("Zara", "node/3101", off(10, 10), "clothes")],
            degraded: false,
          },
          venues: evidence([mall, part, shopNode]),
        })
      );
      expect(view.probable?.name).toBe("Zara");
    });

    it("a shop without a part of its own folds into the mall", () => {
      const view = combineStayIdentity(
        input({
          point: off(10, 10),
          places: {
            results: [place("Zara", "node/3101", off(10, 10), "clothes")],
            degraded: false,
          },
          venues: evidence([mall, shopNode]),
        })
      );
      expect(view.probable?.name).toBe("Alexa");
      expect(view.candidates.find((c) => c.name === "Zara")?.foldedInto).toBe("Alexa");
    });
  });

  it("an administrative area around everything never becomes the venue", () => {
    const district = wayBox(
      4001,
      { name: "Mitte", boundary: "administrative", admin_level: "9", place: "suburb" },
      0,
      0,
      500
    );
    const landuse = wayBox(4002, { name: "Gewerbegebiet", landuse: "retail" }, 0, 0, 300);
    const view = combineStayIdentity(
      input({
        point: off(60, 0),
        places: {
          results: [place("Kiosk Eck", "node/4101", off(61, 0), "kiosk")],
          degraded: false,
        },
        venues: evidence([
          district,
          landuse,
          nodeAt(4101, { name: "Kiosk Eck", shop: "kiosk" }, 61, 0),
        ]),
      })
    );
    expect(view.probable?.name).toBe("Kiosk Eck");
    expect(view.candidates.some((c) => c.isArea)).toBe(false);
  });

  it.each(["unavailable", "timeout", "rateLimited", "budget", "off"] as const)(
    "falls back to the old ranking and shows why when the venue layer is %s",
    (state) => {
      const counter = off(4, 5);
      const view = combineStayIdentity(
        input({
          point: off(-3, -2),
          places: { results: [place("McCafé", "node/2001", counter, "cafe")], degraded: false },
          photos: { state: "ok", assets: [counterPhoto(counter)], truncated: false },
          venues: { state, elements: [] },
        })
      );
      expect(view.probable).toEqual({
        name: "McCafé",
        source: "nearbyPlace",
        photoSupported: true,
      });
      expect(view.venues).toEqual({ state, resolved: null });
    }
  );

  it("a relation with an inner courtyard does not contain a point in the hole", () => {
    const outer = wayBox(1, {}, 0, 0, 30).geometry;
    const inner = wayBox(2, {}, 0, 0, 10).geometry;
    const rel = {
      type: "relation",
      id: 9001,
      tags: { name: "Hof Café", amenity: "cafe", building: "yes", type: "multipolygon" },
      members: [
        { type: "way", ref: 1, role: "outer", geometry: outer },
        { type: "way", ref: 2, role: "inner", geometry: inner },
      ],
    };
    const inHole = combineStayIdentity(input({ point: off(0, 0), venues: evidence([rel]) }));
    expect(inHole.venues.resolved).toBeNull();
    const inRing = combineStayIdentity(input({ point: off(20, 0), venues: evidence([rel]) }));
    expect(inRing.probable?.name).toBe("Hof Café");
  });
});
