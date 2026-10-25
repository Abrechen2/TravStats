import { distanceM } from "../../../travtrack/classify";
import { LINE_MAX_VERTICES, movementRuns } from "../segment";
import { drive, MIN, point, stop, stopDriveStop } from "./journeyPoints";

/**
 * Movement the logbook may lack (TravTrack plan E7): runs between stays,
 * judged on what a map of them would show — the privacy-cut line.
 */

const T0 = Date.parse("2026-10-20T06:00:00Z");
const opts = (points: { atMs: number }[], circles = []) => ({
  readFromMs: points[0].atMs - 3 * 3_600_000,
  readUntilMs: points[points.length - 1].atMs + 3 * 3_600_000,
  circles,
});

describe("movementRuns", () => {
  it("a 90-minute run between two stays is one run with a speed-profile hint", () => {
    const points = stopDriveStop(T0, 90, 100);
    const runs = movementRuns(points, opts(points));
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run.km).toBeGreaterThan(140);
    expect(run.km).toBeLessThan(160);
    expect(run.medianKmh).toBeGreaterThan(95);
    expect(run.medianKmh).toBeLessThan(105);
    expect(run.modeHint).toBe("road");
    expect(run.startRecorded).toBe(true);
    expect(run.endRecorded).toBe(true);
    expect(run.untilMs - run.fromMs).toBeGreaterThanOrEqual(85 * MIN);
  });

  it("a fast, steady run hints rail", () => {
    const points = stopDriveStop(T0, 90, 200);
    expect(movementRuns(points, opts(points))[0].modeHint).toBe("rail");
  });

  it("an in-flight point makes no journey", () => {
    const leg = drive(T0 + 30 * MIN, 90, 250, 50, 8);
    leg[10] = { ...leg[10], inFlight: true };
    const last = leg[leg.length - 1];
    const points = [
      ...stop(T0, 30, 50, 8),
      ...leg,
      ...stop(last.atMs + 2 * MIN, 30, last.lat, last.lon),
    ];
    expect(movementRuns(points, opts(points))).toEqual([]);
  });

  it("too short, too slow or too few points is no run", () => {
    const short = stopDriveStop(T0, 10, 100); // ~17 km
    expect(movementRuns(short, opts(short))).toEqual([]);
    const slow = stopDriveStop(T0, 240, 8); // a walk
    expect(movementRuns(slow, opts(slow))).toEqual([]);
    const sparse = [
      ...stop(T0, 30, 50, 8),
      ...drive(T0 + 30 * MIN, 90, 100, 50, 8).filter((_, i) => i % 6 === 5),
    ];
    const tail = sparse[sparse.length - 1];
    sparse.push(...stop(tail.atMs + 2 * MIN, 30, tail.lat, tail.lon));
    expect(movementRuns(sparse, opts(sparse))).toEqual([]);
  });

  it("a run cut off by the read's edge is not a run: its start is unknown", () => {
    const points = stopDriveStop(T0, 90, 100).slice(16); // starts mid-drive
    expect(movementRuns(points, { ...opts(points), readFromMs: points[0].atMs - MIN })).toEqual([]);
  });

  it("a long silence ends a run, and its end is said not to be recorded", () => {
    const leg = drive(T0 + 30 * MIN, 90, 100, 50, 8);
    const points = [
      ...stop(T0, 30, 50, 8),
      ...leg,
      point(leg[leg.length - 1].atMs + 5 * 3_600_000, 50, 9.5),
    ];
    const [run] = movementRuns(points, opts(points));
    expect(run.endRecorded).toBe(false);
    expect(run.startRecorded).toBe(true);
  });

  it("a run crossing a zone measures only its visible part and never ends inside it", () => {
    const full = stopDriveStop(T0, 90, 100);
    const plain = movementRuns(full, opts(full))[0];
    // A zone in the middle of the drive: ingest kept no fix inside it.
    const mid = full[40];
    const zone = { lat: mid.lat, lon: mid.lon, radiusM: 4_000 };
    const kept = full.filter((p) => distanceM(p, zone) > zone.radiusM);
    const [run] = movementRuns(kept, opts(kept, [zone] as never));
    expect(run.km).toBeLessThan(plain.km - 7);
    for (const piece of run.line) {
      for (const [lon, lat] of piece) expect(distanceM({ lat, lon }, zone)).toBeGreaterThan(4_000);
    }
    expect(distanceM(run.end, zone)).toBeGreaterThan(4_000);
    expect(distanceM(run.start, zone)).toBeGreaterThan(4_000);

    // The journey ends at home, inside the zone: it ends at its last fix outside.
    const arrival = full[full.length - 1];
    const home = { lat: arrival.lat, lon: arrival.lon, radiusM: 5_000 };
    const toHome = full.filter((p) => distanceM(p, home) > home.radiusM);
    const [homeRun] = movementRuns(toHome, opts(toHome, [home] as never));
    expect(homeRun.endRecorded).toBe(false);
    expect(distanceM(homeRun.end, home)).toBeGreaterThan(5_000);
  });

  it("keeps at most LINE_MAX_VERTICES vertices, ends included", () => {
    const points = [
      ...stop(T0, 30, 50, 8),
      ...Array.from({ length: 900 }, (_, i) =>
        point(T0 + 30 * MIN + (i + 1) * 10_000, 50, 8 + (i + 1) * 0.002)
      ),
    ];
    const last = points[points.length - 1];
    points.push(...stop(last.atMs + 2 * MIN, 30, last.lat, last.lon));
    const [run] = movementRuns(points, opts(points));
    const vertices = run.line.flat();
    expect(vertices.length).toBeLessThanOrEqual(LINE_MAX_VERTICES);
    expect(vertices[0]).toEqual([run.start.lon, run.start.lat]);
    expect(vertices[vertices.length - 1]).toEqual([run.end.lon, run.end.lat]);
    expect(run.pointCount).toBeGreaterThan(890);
  });

  it("a line cut into 150 pieces is stored within the cap, and the call returns", () => {
    // A fix every 20 s at 100 km/h, and a tiny zone on every other chord:
    // 150 visible two-vertex pieces, more ends than the cap can ever hold.
    const leg = Array.from({ length: 300 }, (_, i) =>
      point(T0 + 30 * MIN + (i + 1) * 20_000, 50, 8 + (i + 1) * 0.0078)
    );
    const circles = leg
      .slice(0, -1)
      .flatMap((p, i) =>
        i % 2 === 1 ? [{ lat: 50, lon: (p.lon + leg[i + 1].lon) / 2, radiusM: 100 }] : []
      );
    const last = leg[leg.length - 1];
    const points = [
      ...stop(T0, 30, 50, 8),
      ...leg,
      ...stop(last.atMs + 2 * MIN, 30, last.lat, last.lon),
    ];
    const started = Date.now();
    const runs = movementRuns(points, opts(points, circles as never));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(runs).toHaveLength(1);
    const vertices = runs[0].line.flat();
    expect(vertices.length).toBeLessThanOrEqual(LINE_MAX_VERTICES);
    expect(vertices.length).toBeGreaterThan(0);
    for (const [lon, lat] of vertices) {
      for (const c of circles) expect(distanceM({ lat, lon }, c)).toBeGreaterThan(c.radiusM);
    }
  });
});
