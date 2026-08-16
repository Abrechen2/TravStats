import { describe, it, expect, vi } from "vitest";
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
    isoCountryCode: null,
    lat: 52.5163,
    lon: 13.3777,
    stars: 5,
    amenities: [],
    visited: true,
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

function findPinLayer(layers: ReturnType<typeof buildLodgingPins>): {
  props: { data: unknown; onClick?: (info: unknown) => boolean | void };
} {
  const layer = layers!.find((l) => l.id === "lodging-pins");
  expect(layer).toBeDefined();
  return layer as unknown as { props: { data: unknown; onClick?: (info: unknown) => boolean } };
}

function findLabelLayer(layers: ReturnType<typeof buildLodgingPins>): {
  props: { data: unknown; characterSet?: unknown; visible?: unknown };
} {
  const layer = layers!.find((l) => l.id === "lodging-pins-labels");
  expect(layer).toBeDefined();
  return layer as unknown as {
    props: { data: unknown; characterSet?: unknown; visible?: unknown };
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
    const located2 = makeLodging({
      id: "located-2",
      lat: 48.8566,
      lon: 2.3522,
      name: "Le Meurice",
    });
    const noCoords = makeLodging({ id: "no-coords", lat: null, lon: null });
    const halfLat = makeLodging({ id: "half-lat", lat: 52.5, lon: null });
    const halfLon = makeLodging({ id: "half-lon", lat: null, lon: 13.4 });

    const layers = buildLodgingPins([located, located2, noCoords, halfLat, halfLon]);
    expect(layers).not.toBeNull();

    const pinLayer = findPinLayer(layers);
    const data = pinLayer.props.data as Array<{
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

  it("carries city, country, stayCount and nights onto the pin datum (feeds the hover tooltip)", () => {
    const lodging = makeLodging({
      id: "located-1",
      city: "Ludwigsburg",
      country: "DE",
      stayCount: 3,
      nights: 7,
    });
    const layers = buildLodgingPins([lodging]);
    const pinLayer = findPinLayer(layers);
    const data = pinLayer.props.data as Array<{
      city: string | null;
      country: string | null;
      stayCount: number;
      nights: number;
    }>;
    expect(data[0]).toMatchObject({
      city: "Ludwigsburg",
      country: "DE",
      stayCount: 3,
      nights: 7,
    });
  });

  it("truncates a long lodging name onto the label layer with an ellipsis", () => {
    const lodging = makeLodging({
      id: "located-1",
      name: "The Ritz-Carlton, Berlin — Presidential Wing",
    });
    const layers = buildLodgingPins([lodging]);
    const labelLayer = findLabelLayer(layers);
    const data = labelLayer.props.data as Array<{ shortLabel: string }>;
    expect(data[0].shortLabel.length).toBeLessThanOrEqual(20);
    expect(data[0].shortLabel.endsWith("…")).toBe(true);
  });

  describe("onPinClick wiring", () => {
    it("calls back with the lodging id and reports the click as handled (returns true)", () => {
      const onPinClick = vi.fn();
      const lodging = makeLodging({ id: "located-1" });
      const layers = buildLodgingPins([lodging], 1, 4, { onPinClick });
      const pinLayer = findPinLayer(layers);
      expect(pinLayer.props.onClick).toBeDefined();

      const result = pinLayer.props.onClick!({ object: { lodgingId: "located-1" } });

      expect(onPinClick).toHaveBeenCalledWith("located-1");
      expect(result).toBe(true);
    });

    it("does not call back and reports unhandled when nothing was picked", () => {
      const onPinClick = vi.fn();
      const lodging = makeLodging({ id: "located-1" });
      const layers = buildLodgingPins([lodging], 1, 4, { onPinClick });
      const pinLayer = findPinLayer(layers);

      const result = pinLayer.props.onClick!({ object: undefined });

      expect(onPinClick).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("leaves onClick undefined when no onPinClick is supplied — no accidental background-click suppression", () => {
      const lodging = makeLodging({ id: "located-1" });
      const layers = buildLodgingPins([lodging]);
      const pinLayer = findPinLayer(layers);
      expect(pinLayer.props.onClick).toBeUndefined();
    });
  });

  describe("labels — TextLayer", () => {
    it("builds the label layer with a non-ASCII-safe characterSet (#185)", () => {
      // deck.gl's default TextLayer characterSet only covers ASCII 32-127,
      // so a lodging name like "Zur Post München" loses its umlaut and
      // never renders. This test fails if that prop is ever
      // removed/reverted from lodging-pins-labels.
      const lodging = makeLodging({ id: "located-1", name: "Zur Post München" });
      const layers = buildLodgingPins([lodging]);
      const labelLayer = findLabelLayer(layers);
      expect(labelLayer.props.characterSet).toBe("auto");
    });

    it('hides labels entirely when labelsMode is "off"', () => {
      const lodging = makeLodging({ id: "located-1" });
      const layers = buildLodgingPins([lodging], 1, 4, { labelsMode: "off" });
      const labelLayer = findLabelLayer(layers);
      expect(labelLayer.props.visible).toBe(false);
      expect((labelLayer.props.data as unknown[]).length).toBe(0);
    });

    it('shows every lodging label when labelsMode is "all", regardless of the zoom budget', () => {
      const lodgings = Array.from({ length: 12 }, (_, i) =>
        makeLodging({ id: `located-${i}`, lat: 50 + i * 0.01, lon: 10 + i * 0.01, stayCount: 1 })
      );
      const layers = buildLodgingPins(lodgings, 1, 1, { labelsMode: "all" });
      const labelLayer = findLabelLayer(layers);
      expect(labelLayer.props.visible).toBe(true);
      expect((labelLayer.props.data as unknown[]).length).toBe(12);
    });

    it('defaults to "important" mode, budgeting labels by zoom + stayCount when not specified', () => {
      const lodgings = Array.from({ length: 12 }, (_, i) =>
        makeLodging({
          id: `located-${i}`,
          lat: 50 + i * 5, // spread far apart so distance decluttering doesn't also drop entries
          lon: 10 + i * 5,
          stayCount: i,
        })
      );
      // zoom=1 => labelBudget(1) is a small handful, well under 12.
      const layers = buildLodgingPins(lodgings, 1, 1);
      const labelLayer = findLabelLayer(layers);
      const data = labelLayer.props.data as Array<{ stayCount: number }>;
      expect(data.length).toBeGreaterThan(0);
      expect(data.length).toBeLessThan(12);
      // The highest-stayCount lodgings should be the ones kept.
      expect(Math.max(...data.map((d) => d.stayCount))).toBe(11);
    });
  });
});
