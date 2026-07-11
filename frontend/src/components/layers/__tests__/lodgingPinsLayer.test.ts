import { describe, it, expect } from "vitest";
import { buildLodgingPins } from "../lodgingPinsLayer";
import type { Lodging } from "../../../types/lodging";

function makeLodging(overrides: Partial<Lodging> = {}): Lodging {
  return {
    id: "lodging-1",
    userId: "user-1",
    type: "hotel",
    name: "Hotel Adlon",
    chainId: null,
    chain: null,
    address: null,
    city: "Berlin",
    country: "DE",
    lat: 52.5163,
    lon: 13.3777,
    stars: 5,
    amenities: [],
    notes: null,
    dataSource: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stays: [],
    overallRating: null,
    stayCount: 0,
    nights: 0,
    totalSpendBase: 0,
    totalSpendBaseByCurrency: {},
    ...overrides,
  };
}

describe("buildLodgingPins", () => {
  it("returns null when no lodging has both coordinates", () => {
    const lodgings = [
      makeLodging({ id: "no-coords", lat: null, lon: null }),
      makeLodging({ id: "half-lat", lat: 52.5, lon: null }),
      makeLodging({ id: "half-lon", lat: null, lon: 13.4 }),
    ];
    expect(buildLodgingPins(lodgings)).toBeNull();
  });

  it("produces one datum per located lodging, dropping coordinate-less ones", () => {
    const located = makeLodging({ id: "located-1", lat: 52.5163, lon: 13.3777 });
    const located2 = makeLodging({ id: "located-2", lat: 48.8566, lon: 2.3522, name: "Le Meurice" });
    const noCoords = makeLodging({ id: "no-coords", lat: null, lon: null });
    const halfLat = makeLodging({ id: "half-lat", lat: 52.5, lon: null });
    const halfLon = makeLodging({ id: "half-lon", lat: null, lon: 13.4 });

    const layer = buildLodgingPins([located, located2, noCoords, halfLat, halfLon]);
    expect(layer).not.toBeNull();

    const data = (layer as { props: { data: unknown } }).props.data as Array<{
      position: [number, number];
      lodgingId: string;
    }>;
    expect(data).toHaveLength(2);
    expect(data.map((d) => d.lodgingId).sort()).toEqual(["located-1", "located-2"]);
    const first = data.find((d) => d.lodgingId === "located-1");
    expect(first?.position).toEqual([13.3777, 52.5163]);
  });

  it("returns null for an empty input list", () => {
    expect(buildLodgingPins([])).toBeNull();
  });
});
