import { buildCruiseGeometry, type CruiseGeometryInput } from "../cruiseGeometry";

/**
 * Prod, 2026-10-16: a Nile cruise (kind 'river') came back from
 * `/cruises/:id/geometry` with every leg routed `coarse_a_star` out of the
 * Nile valley to the Red Sea coast near Safaga (~34.3 E) and back — the sea
 * router's land/water mask calls a Nile port land and snaps it to the nearest
 * sea. The two nights in port (Luxor -> Luxor, Aswan -> Aswan) drew an
 * out-and-back spike to the same coast.
 */

type Port = NonNullable<CruiseGeometryInput["departurePort"]>;

const port = (
  id: number,
  name: string,
  lat: number,
  lon: number,
  region: string | null = "river_nile"
): Port => ({
  id,
  name,
  city: name,
  country: "Egypt",
  unlocode: null,
  lat,
  lon,
  timezone: "Africa/Cairo",
  region,
  isUserAdded: false,
});

const LUXOR = port(1, "Luxor", 25.6872, 32.6396);
const ESNA = port(2, "Esna", 25.2933, 32.5536);
const EDFU = port(3, "Edfu", 24.9781, 32.8731);
const KOM_OMBO = port(4, "Kom Ombo", 24.4667, 32.9333);
const ASWAN = port(5, "Aswan", 24.0889, 32.8997);

function cruise(kind: string, calls: Port[]): CruiseGeometryInput {
  return {
    kind,
    departurePort: null,
    arrivalPort: null,
    stops: calls.map((p, i) => ({
      isAtSea: false,
      dayNumber: i + 1,
      portId: p.id,
      port: p,
    })) as unknown as CruiseGeometryInput["stops"],
  };
}

/** East of the river, well short of the Red Sea coast (~33.9 E at Safaga). */
const EAST_OF_THE_NILE = 33.2;

const NILE_ITINERARY = [LUXOR, LUXOR, ESNA, EDFU, KOM_OMBO, ASWAN, ASWAN];

describe("a Nile cruise is drawn along the Nile, not via the Red Sea", () => {
  it("routes no leg through the sea mask", async () => {
    const { collection, routedLegs } = await buildCruiseGeometry(cruise("river", NILE_ITINERARY));
    expect(routedLegs).toBe(0);
    for (const f of collection.features) {
      expect(f.properties.method).not.toBe("coarse_a_star");
      for (const [lon] of f.geometry.coordinates) expect(lon).toBeLessThan(EAST_OF_THE_NILE);
    }
  });

  it("gives a night in port no line at all", async () => {
    const { collection } = await buildCruiseGeometry(cruise("river", NILE_ITINERARY));
    expect(
      collection.features.map((f) => [f.properties.fromPortId, f.properties.toPortId])
    ).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
  });

  it("follows the river anchors the distance is measured on", async () => {
    const { collection } = await buildCruiseGeometry(cruise("river", [LUXOR, EDFU]));
    const [leg] = collection.features;
    expect(leg.properties.method).toBe("river_line");
    expect(leg.properties.geometrySource).toBe("river");
    // Luxor -> Esna -> Edfu, the anchor that coincides with each port dropped.
    expect(leg.geometry.coordinates).toEqual([
      [LUXOR.lon, LUXOR.lat],
      [32.5536, 25.2933],
      [EDFU.lon, EDFU.lat],
    ]);
    // Drawn as given: a spline through sparse anchors would leave the line.
    expect(leg.properties.protectedPrefixCount).toBe(3);
  });

  it("draws a river cruise between ports with no river region as the chord", async () => {
    const a = port(6, "Somewhere", 25.6872, 32.6396, null);
    const b = port(7, "Elsewhere", 24.0889, 32.8997, null);
    const { collection } = await buildCruiseGeometry(cruise("river", [a, b]));
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.method).toBe("direct");
    expect(collection.features[0].properties.geometrySource).toBe("chord");
    expect(collection.features[0].geometry.coordinates).toEqual([
      [a.lon, a.lat],
      [b.lon, b.lat],
    ]);
  });

  it("keeps river ports off the sea router even on a cruise stored as ocean (Yangtze)", async () => {
    const chongqing = port(8, "Chongqing", 29.55, 106.5167, "river_yangtze");
    const yichang = port(9, "Yichang", 30.7, 111.2833, "river_yangtze");
    const { collection, routedLegs } = await buildCruiseGeometry(
      cruise("ocean", [chongqing, yichang])
    );
    expect(routedLegs).toBe(0);
    expect(collection.features[0].properties.method).toBe("river_line");
    expect(collection.features[0].geometry.coordinates).toEqual([
      [chongqing.lon, chongqing.lat],
      [yichang.lon, yichang.lat],
    ]);
  });
});
