import type { StoredPoint } from "../../../tripRecording/segments";
import type { Stop } from "../../legs";
import { buildRoadtripPreview, capWaypoints } from "../preview";

/** "Als Roadtrip übernehmen": stops → stations, the line between them, gaps estimated. */

const MIN = 60_000;
const p = (min: number, lat: number, lon = 8): StoredPoint => [min * MIN, lat, lon, 10];
const stop = (fromMin: number, untilMin: number, lat: number, extra: Partial<Stop> = {}): Stop => ({
  fromMs: fromMin * MIN,
  untilMs: untilMin * MIN,
  anchor: { lat, lon: 8 },
  stayRef: null,
  place: null,
  folded: null,
  ...extra,
});

// Drive 0–30, coffee 30–75 at 50.03, drive 75–100, a recording gap, drive 160–180.
const drive1 = Array.from({ length: 31 }, (_, m) => p(m, 50 + m * 0.001));
const drive2 = Array.from({ length: 26 }, (_, m) => p(75 + m, 50.03 + m * 0.001));
const drive3 = Array.from({ length: 21 }, (_, m) => p(160 + m, 50.1 + m * 0.001));
const coffee = stop(30, 75, 50.03);

describe("buildRoadtripPreview", () => {
  it("makes the start, each real stop and the end a station, with times and dwell", () => {
    const preview = buildRoadtripPreview([drive1, drive2, drive3], [coffee], [])!;
    expect(preview.stations.map((s) => [s.kind, s.arriveMs, s.departMs, s.dwellMs])).toEqual([
      ["start", null, 0, null],
      ["stop", 30 * MIN, 75 * MIN, 45 * MIN],
      ["end", 180 * MIN, null, null],
    ]);
    expect(preview.legs).toHaveLength(2);
  });

  it("names a station after the user's place it lies at, and links it", () => {
    const cafe = { id: "place-1", name: "Café am Markt", lat: 50.0301, lon: 8.0001 };
    const preview = buildRoadtripPreview([drive1, drive2], [coffee], [cafe])!;
    expect(preview.stations[1]).toMatchObject({
      name: "Café am Markt",
      nameSource: "place",
      placeId: "place-1",
    });
  });

  it("falls back to the stop's accepted name, then to none", () => {
    const named = stop(30, 75, 50.03, {
      place: { name: "Raststätte", lat: 50.03, lon: 8, source: "accepted" },
    });
    const preview = buildRoadtripPreview([drive1, drive2], [named], [])!;
    expect(preview.stations[1]).toMatchObject({ name: "Raststätte", placeId: null });
    expect(preview.stations[0].name).toBeNull();
  });

  it("leaves out a stop shorter than the dwell threshold and a dismissed one", () => {
    const short = stop(10, 15, 50.01);
    const wait = stop(40, 70, 50.03, { dismissed: true });
    const preview = buildRoadtripPreview([drive1, drive2], [short, wait], [])!;
    expect(preview.stations.map((s) => s.kind)).toEqual(["start", "end"]);
  });

  it("marks the chord across a recording gap as estimated and counts it apart", () => {
    const preview = buildRoadtripPreview([drive1, drive2, drive3], [coffee], [])!;
    const last = preview.legs[1];
    expect(last.estimated).toHaveLength(1);
    expect(last.estimatedKm).toBeGreaterThan(5);
    expect(last.distanceKm).toBeGreaterThan(last.estimatedKm);
    expect(preview.legs[0].estimated).toEqual([]);
    expect(preview.estimatedKm).toBeCloseTo(last.estimatedKm);
  });

  it("runs every leg from station to station within the drawn-leg limit", () => {
    const long = Array.from({ length: 900 }, (_, m) =>
      p(m, 50 + m * 0.0001, 8 + Math.sin(m) * 0.001)
    );
    const preview = buildRoadtripPreview([long], [], [])!;
    const coords = preview.legs[0].coordinates;
    expect(coords.length).toBeLessThanOrEqual(256);
    expect(coords[0]).toEqual([long[0][2], long[0][1]]);
    expect(coords[coords.length - 1]).toEqual([long[899][2], long[899][1]]);
  });

  it("answers null for a span with no fix", () => {
    expect(buildRoadtripPreview([], [], [])).toBeNull();
  });
});

describe("capWaypoints", () => {
  it("keeps a short line as it is", () => {
    const line: [number, number][] = [
      [8, 50],
      [8.1, 50.1],
    ];
    expect(capWaypoints(line, 256)).toBe(line);
  });
});
