import { prepareMarketAreas } from "./areas";
import { detectMarketVisits } from "./detect";
import { contains, distanceToArea, type MarketArea, type Ring } from "./geometry";
import { previewMarketVisit } from "./preview";
import type { DawarichPoint } from "../dawarichClient";

const ring: Ring = [
  [126, 33],
  [126.004, 33],
  [126.004, 33.004],
  [126, 33.004],
  [126, 33],
];
const market: MarketArea = {
  id: "market",
  name: "Example Market",
  sourceUrl: "https://www.openstreetmap.org/way/1",
  geometry: { type: "Polygon", coordinates: [ring] },
};
const base = Date.parse("2026-10-14T05:00:00Z");
const point = (minute: number, over: Partial<DawarichPoint> = {}): DawarichPoint => ({
  id: minute + 1,
  timestampMs: base + minute * 60_000,
  latitude: 33.002,
  longitude: 126.002,
  accuracy: 10,
  velocity: 0.8,
  altitude: null,
  trackId: null,
  ...over,
});
const walk = () => [0, 2, 4, 6, 8, 10].map((m) => point(m, { longitude: 126.0005 + m * 0.0003 }));

describe("market venue recognition", () => {
  it("recognizes walking across a whole market as one visit with original evidence", () => {
    const result = detectMarketVisits(walk(), [market]);
    expect(result).toHaveLength(1);
    expect(result[0].pointIds).toEqual([1, 3, 5, 7, 9, 11]);
    expect(result[0].interiorPointCount).toBe(6);
    expect(result[0].uncertainties).toContain("sourceUnknown");
  });
  it("is deterministic across shuffled inputs and does not modify source points", () => {
    const points = walk(),
      saved = JSON.stringify(points);
    expect(detectMarketVisits([...points].reverse(), [market])).toEqual(
      detectMarketVisits(points, [market])
    );
    expect(JSON.stringify(points)).toBe(saved);
  });
  it("does not identify a nearby hotel as a market even with many slow points", () => {
    expect(
      detectMarketVisits(
        walk().map((p) => ({ ...p, longitude: 125.9999 })),
        [market]
      )
    ).toEqual([]);
  });
  it("does not turn a fast transit or a short walk-through into a visit", () => {
    expect(
      detectMarketVisits(
        walk().map((p) => ({ ...p, velocity: 8 })),
        [market]
      )
    ).toEqual([]);
    expect(
      detectMarketVisits(
        [0, 0.5, 1, 1.5, 2].map((m) => point(m)),
        [market]
      )
    ).toEqual([]);
  });
  it("requires multiple actual interior points instead of a long boundary-only pause", () => {
    expect(
      detectMarketVisits(
        walk().map((p) => ({ ...p, longitude: 125.99995 })),
        [market]
      )
    ).toEqual([]);
  });
  it("merges a brief excursion but splits a real departure and return", () => {
    const outside = point(5, { longitude: 126.0043 });
    expect(detectMarketVisits([...walk(), outside], [market])).toHaveLength(1);
    const long = [
      ...walk(),
      point(12, { longitude: 126.006 }),
      point(15, { longitude: 126.006 }),
      ...walk().map((p) => ({ ...p, id: p.id + 20, timestampMs: p.timestampMs + 20 * 60_000 })),
    ];
    expect(detectMarketVisits(long, [market])).toHaveLength(2);
  });
  it("does not bridge a long signal gap", () => {
    const points = [0, 1, 2, 30, 31, 32].map((m) => point(m));
    expect(detectMarketVisits(points, [market])).toEqual([]);
  });
  it("rejects poor accuracy and invalid coordinates or velocities", () => {
    for (const bad of [
      { accuracy: 200 },
      { latitude: NaN },
      { longitude: Infinity },
      { velocity: -1 },
      { velocity: NaN },
    ])
      expect(
        detectMarketVisits(
          walk().map((p) => ({ ...p, ...bad })),
          [market]
        )
      ).toEqual([]);
  });
  it("deduplicates timestamp evidence using the more accurate observation", () => {
    const points = walk();
    const duplicates = points.map((p) => ({ ...p, id: p.id + 100, accuracy: 90 }));
    expect(detectMarketVisits([...points, ...duplicates], [market])[0].pointIds).toEqual(
      points.map((p) => p.id)
    );
    expect(
      detectMarketVisits(
        Array.from({ length: 20 }, (_, i) => point(0, { id: i })),
        [market]
      )
    ).toEqual([]);
  });
  it("does not require a velocity field but explains insufficient speed evidence", () => {
    const points = [0, 3, 6, 9, 12].map((m) => point(m, { velocity: null }));
    expect(detectMarketVisits(points, [market])[0].uncertainties).toContain("speedUnknown");
  });
  it("uses derived speed to exclude an unlabelled drive-through", () => {
    const points = [0, 0.01, 0.02, 0.03, 0.04].map((m) =>
      point(m, { velocity: null, longitude: 126.0001 + m * 0.08 })
    );
    expect(detectMarketVisits(points, [market])).toEqual([]);
  });
  it("uses an explicit parent market instead of proposing its individual stalls", () => {
    const child = { ...market, id: "stall", name: "Individual stall", parentId: "market" };
    expect(detectMarketVisits(walk(), [market, child]).map((x) => x.marketId)).toEqual(["market"]);
  });
  it("does not merge two separate neighboring markets", () => {
    const second = {
      ...market,
      id: "other",
      name: "Other Market",
      geometry: {
        type: "Polygon" as const,
        coordinates: [ring.map(([x, y]) => [x + 0.01, y] as const)],
      },
    };
    const points = [
      ...walk(),
      ...walk().map((p) => ({
        ...p,
        id: p.id + 20,
        timestampMs: p.timestampMs + 30 * 60_000,
        longitude: p.longitude + 0.01,
      })),
    ];
    expect(detectMarketVisits(points, [market, second]).map((x) => x.marketId)).toEqual([
      "market",
      "other",
    ]);
  });
});

describe("market polygons", () => {
  it("recognizes separate buildings of one multipolygon as one venue", () => {
    const other = ring.map(([x, y]) => [x + 0.0042, y] as const);
    const multi: MarketArea = {
      ...market,
      geometry: { type: "MultiPolygon", coordinates: [[ring], [other]] },
    };
    const positions = [126.0035, 126.0036, 126.0037, 126.0045, 126.0046, 126.0047];
    const points = walk().map((p, i) => ({ ...p, longitude: positions[i] }));
    expect(detectMarketVisits(points, [multi])).toHaveLength(1);
  });
  it("respects holes even within the boundary tolerance", () => {
    const hole: Ring = [
      [126.001, 33.001],
      [126.003, 33.001],
      [126.003, 33.003],
      [126.001, 33.003],
      [126.001, 33.001],
    ];
    const area = { ...market, geometry: { type: "Polygon" as const, coordinates: [ring, hole] } };
    expect(contains(area, 126.002, 33.002)).toBe(false);
    expect(distanceToArea(area, 126.002, 33.002)).toBe(Infinity);
    expect(
      detectMarketVisits(
        [0, 2, 4, 6, 8].map((m) => point(m)),
        [area]
      )
    ).toEqual([]);
  });
  it.each([
    { ...market, geometry: { type: "Point", coordinates: [126, 33] } },
    { ...market, geometry: { type: "Polygon", coordinates: [ring.slice(0, -1)] } },
    {
      ...market,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [126, 33],
            [126, 33],
            [126, 33],
            [126, 33],
          ],
        ],
      },
    },
    { ...market, parentId: "missing" },
  ])("refuses missing or invalid area evidence", (area) => {
    expect(() => detectMarketVisits(walk(), [area as MarketArea])).toThrow();
  });
  it("refuses duplicate ids and parent cycles", () => {
    expect(() => detectMarketVisits(walk(), [market, market])).toThrow();
    expect(() =>
      detectMarketVisits(walk(), [
        { ...market, parentId: "child" },
        { ...market, id: "child", parentId: "market" },
      ])
    ).toThrow();
  });
});

describe("existing records and partial feature usage", () => {
  const knownPlace = { id: "own", name: "Example Market", lat: 33.002, lon: 126.002 };
  const visit = {
    id: "visit",
    placeId: "own",
    tripId: null,
    visitedAt: "2026-10-14T13:55:00Z",
    visitedAtUtc: "2026-10-14T04:55:00Z",
    visitedPrecision: "minute",
  };
  const candidate = () => detectMarketVisits(walk(), [market])[0];
  it("works without trips, Immich, hotels, flights or existing places", () => {
    const result = previewMarketVisit(candidate(), market, { places: [], visits: [], trips: [] });
    expect(result.status).toBe("review");
    expect(result.tripId).toBeNull();
  });
  it("reads a legacy trip anchor by the shared day rule, not its UTC date", () => {
    // Local midnight of 14 October saved by a UTC+2 browser before the time model.
    const result = previewMarketVisit(candidate(), market, {
      places: [],
      visits: [],
      trips: [
        {
          id: "trip",
          name: "Jeju",
          startDate: "2026-10-13T22:00:00.000Z",
          endDate: "2026-10-13T22:00:00.000Z",
        },
      ],
    });
    expect(result.tripId).toBe("trip");
  });
  it("identifies a recorded market visit without creating anything", () => {
    const result = previewMarketVisit(candidate(), market, {
      places: [knownPlace],
      visits: [visit],
      trips: [],
    });
    expect(result.status).toBe("alreadyRecorded");
    expect(result.existingVisitIds).toEqual(["visit"]);
  });
  it("does not confuse a shop inside the venue with the market itself", () => {
    const result = previewMarketVisit(candidate(), market, {
      places: [{ ...knownPlace, name: "Coffee Stall" }],
      visits: [visit],
      trips: [],
    });
    expect(result.status).toBe("review");
  });
  it("keeps visits on other days or separate stops separate", () => {
    const result = previewMarketVisit(candidate(), market, {
      places: [knownPlace],
      visits: [{ ...visit, visitedAtUtc: "2026-10-14T09:00:00Z" }],
      trips: [],
    });
    expect(result.status).toBe("review");
  });
  it("matches day-only records using the venue's local day", () => {
    const result = previewMarketVisit(candidate(), market, {
      places: [knownPlace],
      visits: [
        {
          ...visit,
          visitedAtUtc: null,
          visitedAt: "2026-10-14T00:00:00Z",
          visitedPrecision: "day",
        },
      ],
      trips: [],
    });
    expect(result.status).toBe("alreadyRecorded");
  });
  it("does not assign overlapping trips automatically", () => {
    const trips = ["one", "two"].map((id) => ({
      id,
      name: id,
      startDate: "2026-10-14",
      endDate: "2026-10-14",
    }));
    const result = previewMarketVisit(candidate(), market, { places: [], visits: [], trips });
    expect(result.tripId).toBeNull();
    expect(result.uncertainties).toContain("tripAmbiguous");
  });
});

describe("shared public market identity", () => {
  it("joins a hall and its grounds only when their public identity agrees", () => {
    const entityRef = "wikidata:Q123";
    const building: MarketArea = {
      ...market,
      id: "building",
      name: "Other spelling of market hall",
      entityRef,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [126.004, 33.001],
            [126.005, 33.001],
            [126.005, 33.003],
            [126.004, 33.003],
            [126.004, 33.001],
          ],
        ],
      },
    };
    const input = walk().map((p, i) => ({ ...p, longitude: i > 2 ? 126.0045 : p.longitude }));
    const result = detectMarketVisits(input, [{ ...market, entityRef }, building]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Example Market");
    expect(result[0].areaIds).toEqual(["building", "market"]);
    expect(result[0].pointIds).toHaveLength(6);
  });
  it("does not merge similar names or nearby footprints with different identities", () => {
    const other = { ...market, id: "neighbor", entityRef: "wikidata:Q124" };
    const result = detectMarketVisits(walk(), [{ ...market, entityRef: "wikidata:Q123" }, other]);
    expect(result).toHaveLength(2);
    expect(result.every((x) => x.uncertainties.includes("overlappingMarkets"))).toBe(true);
  });
  it("identifies a visit recorded at the market hall, even if the larger grounds omit that building", () => {
    const entityRef = "wikidata:Q123";
    const building: MarketArea = {
      ...market,
      id: "building",
      entityRef,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [126.004, 33.001],
            [126.005, 33.001],
            [126.005, 33.003],
            [126.004, 33.003],
            [126.004, 33.001],
          ],
        ],
      },
    };
    const areas = [{ ...market, entityRef }, building];
    const candidate = detectMarketVisits(walk(), areas)[0];
    const prepared = prepareMarketAreas(areas)[0];
    const result = previewMarketVisit(candidate, prepared, {
      places: [{ id: "hall", name: market.name, lat: 33.002, lon: 126.0045 }],
      visits: [
        {
          id: "record",
          placeId: "hall",
          tripId: null,
          visitedAt: null,
          visitedAtUtc: "2026-10-14T05:02:00Z",
          visitedPrecision: "minute",
        },
      ],
      trips: [],
    });
    expect(result.status).toBe("alreadyRecorded");
  });
});

it("does not trust a reported zero speed over clearly observed fast movement", () => {
  const points = Array.from({ length: 13 }, (_, i) =>
    point(i * 0.5, { velocity: 0, longitude: i % 2 ? 126.0038 : 126.0002, accuracy: 1 })
  );
  expect(detectMarketVisits(points, [market])).toEqual([]);
});

it("recognizes a translated existing market by public identity, but not an unrelated shop", () => {
  const area = { ...market, entityRef: "wikidata:Q123" };
  const candidate = detectMarketVisits(walk(), [area])[0];
  const place = {
    id: "existing",
    name: "Anderer Sprachname",
    lat: 33.002,
    lon: 126.002,
    wikidataId: "Q123",
  };
  const visits = [
    {
      id: "visit",
      placeId: place.id,
      tripId: null,
      visitedAt: "2026-10-14T00:00:00Z",
      visitedAtUtc: null,
      visitedPrecision: "day",
    },
  ];
  expect(previewMarketVisit(candidate, area, { places: [place], visits, trips: [] }).status).toBe(
    "alreadyRecorded"
  );
  expect(
    previewMarketVisit(candidate, area, {
      places: [{ ...place, wikidataId: "Q456" }],
      visits,
      trips: [],
    }).status
  ).toBe("review");
});
