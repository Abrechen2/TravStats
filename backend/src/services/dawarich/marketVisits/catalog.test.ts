import { planMarketTiles, marketTileQuery } from "./tiles";
import { parseMarketCatalog } from "./osm";
import {
  discoverMarketAreas,
  fetchMarketTile,
  CATALOG_TTL_MS,
  type CatalogStore,
  type CachedCatalog,
} from "./catalog";
import type { DawarichPoint } from "../dawarichClient";
const point = (m: number, lat = 33.512, lon = 126.527): DawarichPoint => ({
  id: m + 1,
  timestampMs: Date.UTC(2026, 9, 14, 5, m),
  latitude: lat,
  longitude: lon,
  accuracy: 10,
  velocity: 1,
  altitude: null,
  trackId: null,
});
const points = [0, 2, 4, 6, 8].map((m) => point(m));
const shape = [
  { lat: 33.51, lon: 126.525 },
  { lat: 33.51, lon: 126.529 },
  { lat: 33.514, lon: 126.529 },
  { lat: 33.514, lon: 126.525 },
  { lat: 33.51, lon: 126.525 },
];
const raw = {
  elements: [
    {
      type: "way",
      id: 1,
      tags: { amenity: "marketplace", "name:en": "Some Market" },
      geometry: shape,
    },
  ],
};
const response = () =>
  new Response(JSON.stringify(raw), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
function store() {
  const cache = new Map<string, CachedCatalog>();
  const complete = jest.fn(async () => {});
  return {
    cache,
    complete,
    read: jest.fn(async (k: string) => cache.get(k) ?? null),
    write: jest.fn(async (k: string, payload: CachedCatalog["payload"], fetchedAt: Date) => {
      cache.set(k, { payload, fetchedAt });
    }),
    claim: jest.fn(async (at: Date) => at),
  } satisfies CatalogStore & { cache: Map<string, CachedCatalog> };
}
describe("automatic public market catalog", () => {
  it("plans coarse regions worldwide, including southern/western hemispheres", () => {
    const plan = planMarketTiles([0, 2, 4, 6, 8].map((m) => point(m, -18.91, 47.52)));
    expect(plan.tiles).toHaveLength(1);
    expect(plan.tiles[0].south).toBeLessThan(-18.91);
    expect(plan.tiles[0].north).toBeGreaterThan(-18.91);
    expect(planMarketTiles([0, 2, 4, 6, 8].map((m) => point(m, -12, -77))).tiles).toHaveLength(1);
  });
  it("does not query drive-throughs, invalid coordinates, sparse evidence or repeated timestamps", () => {
    expect(planMarketTiles(points.map((p) => ({ ...p, velocity: 20 }))).tiles).toEqual([]);
    expect(planMarketTiles([point(0), point(8)]).tiles).toEqual([]);
    expect(planMarketTiles(points.map((p) => ({ ...p, timestampMs: 1 }))).tiles).toEqual([]);
    expect(planMarketTiles(points.map((p) => ({ ...p, latitude: NaN }))).tiles).toEqual([]);
  });
  it("does not combine fly-bys on different days into dwell evidence", () => {
    expect(
      planMarketTiles(
        [0, 1, 2, 3, 4].map((m) => ({ ...point(0), id: m, timestampMs: m * 86400000 }))
      ).tiles
    ).toEqual([]);
  });
  it("queries public coarse bounding boxes, never personal ids or timestamps", () => {
    const tile = planMarketTiles(points).tiles[0];
    const q = marketTileQuery(tile);
    expect(q).toContain("amenity");
    expect(q).not.toContain(String(points[0].timestampMs));
    expect(q).not.toContain("user");
    expect(q).not.toContain("62902");
    expect(q).toContain("out body geom");
  });
  it("parses closed ways, ignores shops and preserves shared identity", () => {
    const parsed = parseMarketCatalog({
      elements: [
        ...raw.elements,
        { ...raw.elements[0], id: 2, tags: { shop: "supermarket", "name:en": "Super Market" } },
      ],
    });
    expect(parsed.areas).toHaveLength(1);
    expect(parsed.areas[0].sourceUrl).toBe("https://www.openstreetmap.org/way/1");
  });
  it("assembles fragmented multipolygon boundaries and holes", () => {
    const parsed = parseMarketCatalog({
      elements: [
        {
          type: "relation",
          id: 2,
          tags: { amenity: "marketplace", name: "Market", wikidata: "Q123" },
          members: [
            { type: "way", role: "outer", geometry: shape.slice(0, 3) },
            { type: "way", role: "outer", geometry: shape.slice(2) },
            {
              type: "way",
              role: "inner",
              geometry: [
                { lat: 33.511, lon: 126.526 },
                { lat: 33.511, lon: 126.527 },
                { lat: 33.512, lon: 126.527 },
                { lat: 33.511, lon: 126.526 },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.areas[0].entityRef).toBe("wikidata:Q123");
    expect(parsed.areas[0].geometry.type).toBe("MultiPolygon");
    expect(parsed.invalidCount).toBe(0);
  });
  it("reports points and broken boundaries instead of inventing an area", () => {
    const parsed = parseMarketCatalog({
      elements: [
        { type: "node", id: 4, tags: { amenity: "marketplace", name: "Market" } },
        { ...raw.elements[0], geometry: shape.slice(0, 3) },
      ],
    });
    expect(parsed.areas).toHaveLength(0);
    expect(parsed.missingAreas).toHaveLength(1);
    expect(parsed.invalidCount).toBe(1);
  });
  it("rejects upstream remarks and partial payloads instead of caching false emptiness", () => {
    expect(() =>
      parseMarketCatalog({ ...raw, remark: "runtime error: query timed out" })
    ).toThrow();
    expect(() => parseMarketCatalog({})).toThrow();
  });
  it("uses a persistent warm cache without new requests", async () => {
    const s = store(),
      fetcher = jest.fn(async () => response());
    const options = { store: s, isAllowed: async () => true, fetcher };
    const first = await discoverMarketAreas(points, options),
      second = await discoverMarketAreas(points, options);
    expect(first.areas).toHaveLength(1);
    expect(second.coverage.cachedTiles).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("makes zero requests after consent is revoked", async () => {
    const s = store(),
      fetcher = jest.fn(async () => response());
    const result = await discoverMarketAreas(points, {
      store: s,
      isAllowed: async () => false,
      fetcher,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.coverage.status).toBe("cancelled");
  });
  it("does not write a cache result returned after revocation", async () => {
    const s = store();
    let allowed = true;
    const result = await discoverMarketAreas(points, {
      store: s,
      isAllowed: async () => allowed,
      fetcher: async () => {
        allowed = false;
        return response();
      },
    });
    expect(s.write).not.toHaveBeenCalled();
    expect(result.coverage.status).toBe("cancelled");
    expect(s.complete).toHaveBeenCalled();
  });
  it("keeps a region complete when one boundary in it is broken", async () => {
    // One invalid OSM relation used to mark every scan of its region partial,
    // permanently, because the broken boundary stays in the cached tile.
    const broken = {
      elements: [
        ...raw.elements,
        {
          type: "relation",
          id: 99,
          tags: { amenity: "marketplace", name: "Broken" },
          geometry: shape.slice(0, 3),
        },
      ],
    };
    const result = await discoverMarketAreas(points, {
      store: store(),
      isAllowed: async () => true,
      fetcher: async () => Response.json(broken),
    });
    expect(result.areas).toHaveLength(1);
    expect(result.coverage.invalidAreaCount).toBe(1);
    expect(result.coverage.status).toBe("complete");
  });
  it("preserves stale cached data during outage and reports partial coverage", async () => {
    const s = store(),
      fetcher = jest.fn(async () => response());
    let now = new Date("2026-10-15T00:00:00Z");
    await discoverMarketAreas(points, {
      store: s,
      isAllowed: async () => true,
      fetcher,
      clock: () => now,
    });
    now = new Date(now.getTime() + CATALOG_TTL_MS + 1);
    const result = await discoverMarketAreas(points, {
      store: s,
      isAllowed: async () => true,
      fetcher: async () => {
        throw Error("offline");
      },
      clock: () => now,
    });
    expect(result.areas).toHaveLength(1);
    expect(result.coverage.staleTiles).toBe(1);
    expect(result.coverage.status).toBe("partial");
  });
  it("stops after rate limiting, records backoff and never retries in parallel", async () => {
    const s = store(),
      fetcher = jest.fn(
        async () => new Response("", { status: 429, headers: { "retry-after": "60" } })
      );
    const result = await discoverMarketAreas(
      [...points, ...points.map((p) => ({ ...p, id: p.id + 30, latitude: p.latitude + 0.2 }))],
      { store: s, isAllowed: async () => true, fetcher }
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(s.complete).toHaveBeenCalledWith(expect.any(Date), 0, 60000);
    expect(result.coverage.status).toBe("partial");
  });
  it("respects the shared budget and does not pretend unavailable regions were checked", async () => {
    const s = store();
    s.claim.mockResolvedValue(null as never);
    const fetcher = jest.fn(async () => response());
    const result = await discoverMarketAreas(points, {
      store: s,
      isAllowed: async () => true,
      fetcher,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.coverage.failedTiles).toBe(1);
    expect(result.coverage.tiles).toBe(0);
    expect(result.coverage.status).toBe("partial");
  });
  it("bounds response bodies before parsing", async () => {
    const cancelled = jest.fn();
    const response = new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { "content-length": "999999999" },
    });
    await expect(
      fetchMarketTile(
        planMarketTiles(points).tiles[0],
        "https://overpass.invalid",
        async () => response
      )
    ).rejects.toThrow();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
