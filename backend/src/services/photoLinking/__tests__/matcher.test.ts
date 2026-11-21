import { describe, it, expect } from "@jest/globals";

import { matchAssets, matches, type MatchSpec, type SourcedAsset } from "../matcher";
import type { PhotoSourceAsset } from "../../photoSource/types";

const asset = (id: string, over: Partial<PhotoSourceAsset> = {}): PhotoSourceAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2024-05-01T10:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1,
  lat: 50,
  lon: 8,
  ...over,
});
const spec = (over: Partial<MatchSpec> = {}): MatchSpec => ({
  window: { start: new Date("2024-05-01T00:00:00Z"), end: new Date("2024-05-01T23:59:59Z") },
  locations: [{ kind: "point", lat: 50, lon: 8, radiusKm: 1 }],
  circles: [],
  refused: new Set(),
  cap: 10,
  ...over,
});

describe("photo matcher", () => {
  it("abstains on a missing time, a missing position or a non-finite time", () => {
    expect(matches(asset("a", { fileCreatedAt: null }), spec())).toBe(false);
    expect(matches(asset("a", { lat: null }), spec())).toBe(false);
    expect(matches(asset("a", { fileCreatedAt: "not a date" }), spec())).toBe(false);
  });

  it("matches along a corridor between two points, not beside it", () => {
    const corridor = spec({
      locations: [
        { kind: "corridor", from: { lat: 50, lon: 8 }, to: { lat: 50, lon: 9 }, radiusKm: 2 },
      ],
    });
    expect(matches(asset("mid", { lat: 50.005, lon: 8.5 }), corridor)).toBe(true);
    expect(matches(asset("off", { lat: 50.5, lon: 8.5 }), corridor)).toBe(false);
  });

  it("drops privacy-zone, refused and over-cap photos, earliest first", () => {
    const all: SourcedAsset[] = [
      { provider: "immich", asset: asset("zone") },
      { provider: "immich", asset: asset("refused") },
      { provider: "immich", asset: asset("late", { fileCreatedAt: "2024-05-01T12:00:00Z" }) },
      { provider: "photoprism", asset: asset("early", { fileCreatedAt: "2024-05-01T08:00:00Z" }) },
    ];
    const out = matchAssets(
      all,
      spec({
        circles: [{ lat: 50, lon: 8, radiusM: 0 }],
        refused: new Set(["immich:refused"]),
        cap: 1,
      })
    );
    // radius 0 only holds the exact point: zone/refused/late/early all sit on it, so 0 survive.
    expect(out).toEqual([]);
    const free = matchAssets(all.slice(1), spec({ refused: new Set(["immich:refused"]), cap: 1 }));
    expect(free.map((c) => c.asset.id)).toEqual(["early"]);
  });
});
