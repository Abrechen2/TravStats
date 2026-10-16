import { parseMarketCatalog } from "./osm";
import { detectMarketVisits } from "./detect";
import { prepareMarketAreas } from "./areas";
import { marketTileQuery, planMarketTiles } from "./tiles";
import { discoverMarketAreas, type CachedCatalog } from "./catalog";
import { isMarketFragment } from "./integration";
import { venueType, venueCategory, type VenueType } from "./venueTypes";
import type { MarketArea } from "./geometry";
import type { DawarichPoint } from "../dawarichClient";
const area: MarketArea = {
  id: "way/1",
  name: "Venue",
  sourceUrl: "https://www.openstreetmap.org/way/1",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [126.969, 37.569],
        [126.971, 37.569],
        [126.971, 37.571],
        [126.969, 37.571],
        [126.969, 37.569],
      ],
    ],
  },
};
const walk = (minutes = 20): DawarichPoint[] =>
  Array.from({ length: minutes + 1 }, (_, i) => ({
    id: i + 1,
    latitude: 37.57,
    longitude: 126.97,
    timestampMs: Date.parse("2026-10-10T00:00:00Z") + i * 60000,
    accuracy: 5,
    velocity: 0.1,
    altitude: null,
    trackId: null,
  }));
const raw = (tags: Record<string, string>) => ({
  elements: [
    {
      type: "way",
      id: 1,
      tags: { name: "Venue", ...tags },
      geometry: area.geometry.coordinates[0].map(([lon, lat]) => ({ lon, lat })),
    },
  ],
});
const tags: [Record<string, string>, VenueType][] = [
  [{ shop: "mall" }, "mall"],
  [{ leisure: "park" }, "park"],
  [{ tourism: "zoo" }, "zoo"],
  [{ tourism: "theme_park" }, "themePark"],
  [{ tourism: "museum" }, "museum"],
];
describe("whole venue boundaries", () => {
  it.each(tags)("recognizes %j only with the broader profile", (input, type) => {
    expect(venueType(input)).toBe(type);
    expect(parseMarketCatalog(raw(input)).areas).toHaveLength(0);
    expect(parseMarketCatalog(raw(input), true).areas[0]).toMatchObject({ venueType: type });
  });
  it.each([
    { shop: "supermarket" },
    { shop: "department_store" },
    { landuse: "retail" },
    { landuse: "forest" },
    { boundary: "national_park" },
    { tourism: "attraction" },
  ])("does not infer a whole venue from %j", (input) => expect(venueType(input)).toBeNull());
  it("never invents an area for a node-only museum", () => {
    const result = parseMarketCatalog(
      {
        elements: [
          {
            type: "node",
            id: 22,
            tags: { tourism: "museum", name: "Museum" },
            lat: 37.57,
            lon: 126.97,
          },
        ],
      },
      true
    );
    expect(result.areas).toHaveLength(0);
    expect(result.missingAreas[0]).toMatchObject({ id: "node/22", venueType: "museum" });
  });
  it.each(["mall", "zoo", "themePark", "museum"] as VenueType[])(
    "requires ten minutes at %s",
    (venueType) => {
      expect(detectMarketVisits(walk(9), [{ ...area, venueType }])).toHaveLength(0);
      expect(detectMarketVisits(walk(10), [{ ...area, venueType }])).toHaveLength(1);
    }
  );
  it("does not treat a short park crossing as a park visit", () => {
    expect(detectMarketVisits(walk(14), [{ ...area, venueType: "park" }])).toHaveLength(0);
    expect(detectMarketVisits(walk(15), [{ ...area, venueType: "park" }])).toHaveLength(1);
    expect(detectMarketVisits(walk(5), [area])).toHaveLength(1);
  });
  it("preserves independent nested venues even when their public identity was reused", () => {
    const venues = [
      { ...area, venueType: "park" as const, entityRef: "wikidata:Q123" },
      { ...area, id: "way/2", venueType: "museum" as const, entityRef: "wikidata:Q123" },
    ];
    expect(prepareMarketAreas(venues)).toHaveLength(2);
    const hits = detectMarketVisits(walk(), venues);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.uncertainties.includes("overlappingMarkets"))).toBe(true);
  });
  it("does not absorb a known independent place inside a park", () => {
    const park = { ...area, venueType: "park" as const };
    const points = walk();
    const hits = detectMarketVisits(points, [park]);
    const scan = {
      hits,
      areas: prepareMarketAreas([park]),
      findings: [],
      coverage: {},
    } as unknown as Parameters<typeof isMarketFragment>[1];
    const candidate = {
      startAt: hits[0].startAt,
      endAt: hits[0].endAt,
      lat: 37.57,
      lon: 126.97,
      pointIds: points.map((p) => p.id),
      pointCount: points.length,
      maxGapMinutes: 1,
      uncertainties: [],
    };
    expect(isMarketFragment(candidate, scan)).toBe(true);
    expect(
      isMarketFragment(candidate, scan, [
        { id: "own", name: "Independent museum", lat: 37.57, lon: 126.97 },
      ])
    ).toBe(false);
  });
  it("queries explicit venue tags instead of arbitrary shops or protected regions", () => {
    const tile = planMarketTiles(walk()).tiles[0];
    expect(marketTileQuery(tile)).not.toContain('"mall"');
    const q = marketTileQuery(tile, true);
    expect(q).toContain('["shop"="mall"]');
    expect(q).toContain('["leisure"="park"]');
    expect(q).toContain("^(zoo|theme_park|museum)$");
  });
  it("keeps old market-only caches separate from broader venue maps", async () => {
    const cache = new Map<string, CachedCatalog>();
    const store = {
      read: async (k: string) => cache.get(k) ?? null,
      write: async (k: string, payload: CachedCatalog["payload"], fetchedAt: Date) => {
        cache.set(k, { payload, fetchedAt });
      },
      claim: async (at: Date) => at,
      complete: async () => {},
    };
    const fetcher = jest.fn(async () => Response.json(raw({ shop: "mall" })));
    const options = { store, isAllowed: async () => true, fetcher };
    expect((await discoverMarketAreas(walk(), options)).areas).toHaveLength(0);
    expect(
      (await discoverMarketAreas(walk(), { ...options, includeVenues: true })).areas
    ).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await discoverMarketAreas(walk(), { ...options, includeVenues: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect([...cache.keys()].some((k) => k.startsWith("market-v1:"))).toBe(true);
    expect([...cache.keys()].some((k) => k.startsWith("venue-v1:"))).toBe(true);
  });
  it("maps accepted venues to the existing category vocabulary", () => {
    expect(venueCategory("museum")).toBe("museum");
    expect(venueCategory("themePark")).toBe("entertainment");
    expect(venueCategory("mall")).toBe("shopping");
  });
});
