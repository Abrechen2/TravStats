import { describe, it, expect } from "vitest";
import { declutterByDistance, labelBudget, pickLabelled } from "./labelPriority";

const w = (n: number) => ({ v: n });
const weightOf = (x: { v: number }) => x.v;

interface GeoPoint {
  weight: number;
  position: [number, number];
}
const geo = (weight: number, lon: number, lat: number): GeoPoint => ({ weight, position: [lon, lat] });
const geoWeight = (p: GeoPoint) => p.weight;
const geoPosition = (p: GeoPoint) => p.position;

describe("labelBudget", () => {
  it("grows monotonically with zoom", () => {
    const zooms = [0, 1, 2, 3, 4, 5, 6];
    const budgets = zooms.map(labelBudget);
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i]).toBeGreaterThanOrEqual(budgets[i - 1]);
    }
  });

  it("keeps a small floor at world zoom", () => {
    expect(labelBudget(0)).toBe(5);
    expect(labelBudget(1)).toBe(5);
  });

  it("is large enough to label most markers by mid zoom", () => {
    expect(labelBudget(6)).toBeGreaterThan(60);
  });
});

describe("pickLabelled", () => {
  const items = [w(1), w(50), w(3), w(20), w(100), w(2)];

  it("labels nothing when off", () => {
    expect(pickLabelled(items, weightOf, "off", 10)).toEqual([]);
  });

  it("labels everything when all (any zoom)", () => {
    expect(pickLabelled(items, weightOf, "all", 0)).toHaveLength(items.length);
  });

  it("spends the zoom budget on the heaviest markers first", () => {
    // zoom 0 → budget 5, but force a tighter view: use few items vs budget.
    const many = Array.from({ length: 40 }, (_, i) => w(i));
    const picked = pickLabelled(many, weightOf, "important", 1); // budget 5
    expect(picked).toHaveLength(5);
    // The five heaviest (39,38,37,36,35) survive.
    expect(picked.map(weightOf).sort((a, b) => a - b)).toEqual([35, 36, 37, 38, 39]);
  });

  it("returns all items when they fit under budget", () => {
    const picked = pickLabelled(items, weightOf, "important", 6); // huge budget
    expect(picked).toHaveLength(items.length);
  });
});

describe("declutterByDistance", () => {
  it("returns everything unchanged when the list is empty or a singleton", () => {
    expect(declutterByDistance([], geoWeight, geoPosition, 5)).toEqual([]);
    const one = [geo(10, 11.79, 48.35)];
    expect(declutterByDistance(one, geoWeight, geoPosition, 5)).toEqual(one);
  });

  it("keeps all markers when they're far enough apart on screen", () => {
    // Roughly Munich, Tokyo, New York, Sydney — nothing here is remotely
    // close at any sane zoom.
    const farApart = [geo(10, 11.79, 48.35), geo(5, 139.84, 35.65), geo(8, -73.97, 40.71), geo(3, 151.21, -33.87)];
    expect(declutterByDistance(farApart, geoWeight, geoPosition, 5)).toHaveLength(4);
  });

  it("keeps only the heaviest marker in a dense regional cluster (#label-overlap)", () => {
    // Munich/Frankfurt/Vienna/Zurich/Paris-CDG-like cluster: all real central
    // European hubs within ~700km of each other. At a middling zoom where
    // pickLabelled alone would let all five "fit the budget", they're still
    // only a few dozen screen pixels apart — declutterByDistance is the pass
    // that actually notices and thins them out.
    const hubs = [
      geo(500, 11.79, 48.35), // MUC — heaviest
      geo(300, 8.57, 50.03), // FRA
      geo(200, 16.57, 48.11), // VIE
      geo(150, 8.55, 47.46), // ZRH
      geo(100, 2.55, 49.01), // CDG
    ];
    const kept = declutterByDistance(hubs, geoWeight, geoPosition, 2);
    expect(kept).toHaveLength(1);
    expect(kept[0].weight).toBe(500);
  });

  it("prefers the heavier of two markers that are too close, even when the lighter one comes first", () => {
    const close = [geo(10, 11.79, 48.35), geo(50, 11.8, 48.36)];
    const kept = declutterByDistance(close, geoWeight, geoPosition, 5);
    expect(kept).toHaveLength(1);
    expect(kept[0].weight).toBe(50);
  });

  it("respects a smaller minPixelGap, revealing more markers", () => {
    const close = [geo(10, 11.79, 48.35), geo(50, 11.8, 48.36)];
    const kept = declutterByDistance(close, geoWeight, geoPosition, 5, 0);
    expect(kept).toHaveLength(2);
  });
});
