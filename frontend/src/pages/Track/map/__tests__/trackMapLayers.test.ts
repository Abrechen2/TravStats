import { describe, expect, it, vi } from "vitest";
import type { TrackPoint, TravTrackDayEntry } from "../../../../lib/api/travtrack";
import { anchorGroup, buildTrackLayers, mapAnchors, type TrackLayerInput } from "../trackMapLayers";
import { DEFAULT_PREFS, parsePrefs, TRACK_LAYERS } from "../trackMapPrefs";

/**
 * The Track map's layers (plan T5.2): each switch draws its layer and nothing
 * else, and no privacy zone is ever drawn on the ordinary map.
 */

const seg: TrackPoint[] = [
  [0, 52.5, 13.4, 5],
  [60_000, 52.51, 13.41, 5],
];

const input = (over: Partial<TrackLayerInput> = {}): TrackLayerInput => ({
  layers: Object.fromEntries(TRACK_LAYERS.map((id) => [id, true])) as TrackLayerInput["layers"],
  color: "speed",
  opacity: 0.8,
  lines: [seg.map((q) => [q[2], q[1]])],
  segments: [seg],
  points: seg.map((point, i) => ({ point, zone: "UTC", id: `p-${i}` })),
  anchors: [
    { lat: 1, lon: 1, kind: "home", text: "Zuhause", group: "visits", open: false },
    { lat: 2, lon: 2, kind: "flight", text: "Flug", group: "entries", open: false },
  ],
  replay: [],
  onPoint: vi.fn(),
  photos: [],
  onPhoto: vi.fn(),
  countries: [],
  ...over,
});

const ids = (i: TrackLayerInput) => buildTrackLayers(i).map((l) => l.id);

describe("buildTrackLayers", () => {
  it("draws no zone, whatever is switched on", () => {
    const all = ids(input());
    expect(all.some((id) => /zone/i.test(id))).toBe(false);
    expect(all).toEqual([
      "track-heat",
      "track-route-speed",
      "track-points",
      "track-visits",
      "track-entries",
    ]);
  });

  it("each switch removes exactly its own layer", () => {
    const expected: Record<string, string> = {
      heat: "track-heat",
      routes: "track-route-speed",
      points: "track-points",
      visits: "track-visits",
      entries: "track-entries",
    };
    for (const [layer, id] of Object.entries(expected)) {
      const on = { ...input().layers, [layer]: false };
      const got = ids(input({ layers: on }));
      expect(got).not.toContain(id);
      expect(got).toHaveLength(4);
    }
    const none = Object.fromEntries(TRACK_LAYERS.map((id) => [id, false]));
    expect(ids(input({ layers: none as TrackLayerInput["layers"] }))).toEqual([]);
  });

  it("draws photos only where the server placed them, and a click opens one", () => {
    const photo = {
      assetId: "a1",
      type: "IMAGE" as const,
      takenAt: "2026-10-25T06:00:30.000Z",
      lat: 52.505,
      lon: 13.405,
    };
    const onPhoto = vi.fn();
    expect(ids(input())).not.toContain("track-photos");
    const layer = buildTrackLayers(input({ photos: [photo], onPhoto })).find(
      (l) => l.id === "track-photos"
    );
    expect(layer).toBeDefined();
    const props = layer!.props as unknown as {
      data: (typeof photo)[];
      getPosition: (p: typeof photo) => [number, number];
      onClick: (info: { object: typeof photo }) => boolean;
    };
    expect(props.data.map(props.getPosition)).toEqual([[13.405, 52.505]]);
    props.onClick({ object: photo });
    expect(onPhoto).toHaveBeenCalledWith(photo);
    const off = { ...input().layers, photos: false };
    expect(ids(input({ layers: off, photos: [photo] }))).not.toContain("track-photos");
  });

  it("colours the visited countries under everything else, only while switched on", () => {
    const de = {
      type: "Feature" as const,
      id: "276",
      properties: { name: "Germany" },
      geometry: { type: "Point" as const, coordinates: [10, 51] },
    };
    expect(ids(input())).not.toContain("track-countries");
    const all = ids(input({ countries: [de] }));
    expect(all[0]).toBe("track-countries");
    const off = { ...input().layers, countries: false };
    expect(ids(input({ layers: off, countries: [de] }))).not.toContain("track-countries");
  });

  it("single colour draws the stretches whole; the replay adds its head", () => {
    expect(ids(input({ color: "plain" }))).toContain("track-route-plain");
    expect(ids(input({ replay: [[13.4, 52.5]] }))).toContain("track-replay-head");
  });

  it("a click on a point opens it", () => {
    const onPoint = vi.fn();
    const layer = buildTrackLayers(input({ onPoint })).find((l) => l.id === "track-points");
    const point = { point: seg[0], zone: "UTC" };
    (layer?.props as unknown as { onClick: (info: { object: unknown }) => void }).onClick({
      object: point,
    });
    expect(onPoint).toHaveBeenCalledWith(point);
  });
});

describe("anchors", () => {
  const entry = (over: Partial<TravTrackDayEntry>): TravTrackDayEntry => ({
    kind: "flight",
    id: "x",
    label: "L",
    href: null,
    anchor: { lat: 1, lon: 2 },
    unlabelled: false,
    fromMs: 0,
    untilMs: 1,
    ...over,
  });

  it("stays and places on one switch, journeys on the other; no anchor, no marker", () => {
    expect(anchorGroup(entry({ kind: "home" }))).toBe("visits");
    expect(anchorGroup(entry({ kind: "lodging" }))).toBe("visits");
    expect(anchorGroup(entry({ kind: "suggestion", suggestion: "stay" }))).toBe("visits");
    expect(anchorGroup(entry({ kind: "suggestion", suggestion: "journey" }))).toBe("entries");
    expect(anchorGroup(entry({ kind: "rail" }))).toBe("entries");
    const t = (k: string) => k;
    expect(mapAnchors([entry({}), entry({ anchor: null })], t)).toHaveLength(1);
  });
});

describe("parsePrefs", () => {
  it("falls back field by field and on anything unreadable", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{nope")).toEqual(DEFAULT_PREFS);
    const got = parsePrefs(
      JSON.stringify({
        layers: { heat: true, points: "yes" },
        color: "rainbow",
        opacity: 5,
        splitMinutes: 30,
      })
    );
    expect(got.layers.heat).toBe(true);
    expect(got.layers.points).toBe(DEFAULT_PREFS.layers.points);
    expect(got.color).toBe(DEFAULT_PREFS.color);
    expect(got.opacity).toBe(DEFAULT_PREFS.opacity);
    expect(got.splitMinutes).toBe(30);
    expect(parsePrefs(JSON.stringify({ splitMinutes: 7 })).splitMinutes).toBeNull();
  });
});

describe("buildTrackLayers on a replay tick (forgejo#351)", () => {
  it("keeps every static layer's data by reference when only the replay head moved", () => {
    const base = input({
      countries: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
      ],
    });
    const dataOf = (i: TrackLayerInput): Record<string, unknown> =>
      Object.fromEntries(
        buildTrackLayers(i).map((l) => [l.id, (l.props as { data?: unknown }).data])
      );
    const a = dataOf({ ...base, replay: [[13.4, 52.5]] });
    const b = dataOf({ ...base, replay: [[13.41, 52.51]] });
    for (const id of [
      "track-countries",
      "track-heat",
      "track-route-speed",
      "track-points",
      "track-visits",
      "track-entries",
    ]) {
      expect(a[id], id).toBeDefined();
      expect(b[id], `${id} got new data on a replay tick`).toBe(a[id]);
    }
    expect(b["track-replay-head"]).not.toBe(a["track-replay-head"]);
  });
});

describe("buildTrackLayers opacity with stable data (forgejo#351)", () => {
  it("re-colours the speed route when the opacity changes", () => {
    const triggers = (opacity: number): unknown =>
      (
        buildTrackLayers(input({ opacity })).find((l) => l.id === "track-route-speed")
          ?.props as unknown as { updateTriggers: { getColor: unknown } }
      ).updateTriggers.getColor;
    expect(triggers(0.4)).not.toEqual(triggers(0.9));
  });
});
