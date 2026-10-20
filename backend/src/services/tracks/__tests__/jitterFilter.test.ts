import { ingestTrack } from "../../tour/tracks/ingestTrack";
import type { ParsedTrack } from "../../tour/tracks/parseGpx";
import { filterJitter, type JitterFix } from "../jitterFilter";
import { JITTER_PROFILES, tourJitterMode, type JitterMode } from "../jitterProfiles";
import { filterParsedTrack } from "../recordingJitter";
import { haversineKm } from "../../../shared/geo/haversine";
import {
  BASE,
  T0,
  last,
  moving,
  noise,
  offset,
  standing,
  type SyntheticFix,
} from "./jitterFixtures";

function parsed(fixes: readonly SyntheticFix[], segmentStarts = [0]): ParsedTrack {
  return {
    points: fixes.map((f): [number, number] => [f.lon, f.lat]),
    segmentStarts,
    startedAt: new Date(fixes[0].t),
    endedAt: new Date(last(fixes).t),
    name: null,
    times: fixes.map((f) => f.t),
    accuracies: fixes.map((f) => f.accuracy),
  };
}

function asFixes(fixes: readonly SyntheticFix[]): JitterFix[] {
  return fixes.map((f) => ({ lon: f.lon, lat: f.lat, t: f.t, accuracyM: f.accuracy }));
}

/** The distance the stored row would carry, after the filter. */
function measuredKm(fixes: readonly SyntheticFix[], mode: JitterMode): number {
  return ingestTrack(filterParsedTrack(parsed(fixes), mode))!.distanceKm;
}

function rawKm(fixes: readonly SyntheticFix[]): number {
  return ingestTrack(parsed(fixes))!.distanceKm;
}

/** Turns of more than 120° along a line — a zigzag is a run of them. */
function sharpTurns(line: ReadonlyArray<[number, number]>): number {
  let turns = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const [ax, ay] = [line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]];
    const [bx, by] = [line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]];
    const norm = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (norm > 0 && (ax * bx + ay * by) / norm < Math.cos((120 * Math.PI) / 180)) turns += 1;
  }
  return turns;
}

describe("jitter filter — a still phone at the gate (forgejo#319)", () => {
  // 30 min at the gate, a fix every 10 s wandering ±150 m with no accuracy
  // (the Companion's flight recorder sends none), then a 2 km taxi at
  // 15 km/h, then the take-off roll and climb-out at 300 km/h for 10 min.
  const gate = standing(BASE, T0, 30, 10, 150);
  const taxiStart = T0 + 30 * 60_000;
  const taxi = moving(BASE, taxiStart, 90, 15, 480, 10);
  const climb = moving(last(taxi), last(taxi).t, 90, 300, 600, 10);
  const flight = [...gate, ...taxi, ...climb];
  const trueKm = 2 + 50;

  it("collapses the gate cloud to one point, so the drawn line has no zigzag there", () => {
    const filtered = filterParsedTrack(parsed(flight), "flight");
    const ingested = ingestTrack(filtered)!;
    const nearGate = ingested.geometry.filter(
      ([lon, lat]) => haversineKm({ lat, lon }, BASE) < 0.3
    );
    expect(nearGate.length).toBeLessThanOrEqual(3);
    expect(sharpTurns(ingested.geometry)).toBe(0);
    expect(sharpTurns(ingestTrack(parsed(flight))!.geometry)).toBeGreaterThan(20);
  });

  it("brings the distance down to the real path, within 2 %", () => {
    expect(rawKm(flight)).toBeGreaterThan(trueKm + 10);
    expect(Math.abs(measuredKm(flight, "flight") - trueKm) / trueKm).toBeLessThan(0.02);
  });

  it("counts every fix it removed and keeps the raw count", () => {
    const ingested = ingestTrack(filterParsedTrack(parsed(flight), "flight"))!;
    expect(ingested.pointCount).toBe(flight.length);
    expect(ingested.jitterDropped).toBeGreaterThanOrEqual(gate.length - 3);
    // The recording still began when the phone began recording.
    expect(ingested.startedAt.getTime()).toBe(T0);
  });

  it("collapses a cloud that drifts rather than scatters — a random walk 140 m wide", () => {
    const rnd = noise(3);
    let east = 0;
    let north = 0;
    const drift: SyntheticFix[] = Array.from({ length: 180 }, (_, i) => {
      east = east * 0.98 + rnd() * 25;
      north = north * 0.98 + rnd() * 25;
      return { t: T0 + i * 10_000, ...offset(BASE, east, north), accuracy: null };
    });
    expect(filterJitter(asFixes(drift), [0], JITTER_PROFILES.flight).fixes).toHaveLength(1);
  });

  it("collapses a cloud the phone reports accuracy for, inside that accuracy", () => {
    const cafe = standing(BASE, T0, 60, 60, 80, 90, 3);
    const walk = moving(BASE, last(cafe).t, 0, 4.5, 600, 15, 8);
    const result = filterJitter(asFixes([...cafe, ...walk]), [0], JITTER_PROFILES.mixed);
    // The first steps away still lie inside the reported 90 m of the cloud's
    // centre — itself known only to tens of metres — and join the stay; the
    // walk beyond is kept fix by fix.
    expect(result.dropped).toBeGreaterThanOrEqual(cafe.length - 1);
    expect(result.dropped).toBeLessThanOrEqual(cafe.length - 1 + Math.ceil((2 * 90) / 18.75));
    const line = result.fixes.map((f): [number, number] => [f.lon, f.lat]);
    expect(sharpTurns(line)).toBe(0);
  });
});

describe("jitter filter — teleports and frozen fixes", () => {
  const drive = moving(BASE, T0, 45, 60, 600, 5);

  it("drops a one-fix out-and-back spike and keeps the distance within 0.5 %", () => {
    const spiked = [...drive];
    spiked[60] = { ...spiked[60], ...offset(spiked[60], 4000, -3000) };
    const result = filterJitter(asFixes(spiked), [0], JITTER_PROFILES.road);
    expect(result.dropped).toBe(1);
    const trueKm = rawKm(drive);
    expect(Math.abs(measuredKm(spiked, "road") - trueKm) / trueKm).toBeLessThan(0.005);
    expect(rawKm(spiked)).toBeGreaterThan(19);
  });

  it("drops a spike of three fixes, and a spike on the very first fix", () => {
    const spiked = [...drive];
    for (const i of [30, 31, 32]) spiked[i] = { ...spiked[i], ...offset(spiked[i], 0, 5000) };
    spiked[0] = { ...spiked[0], ...offset(spiked[0], -6000, 0) };
    const result = filterJitter(asFixes(spiked), [0], JITTER_PROFILES.road);
    expect(result.dropped).toBe(4);
  });

  it("keeps a jump that does not come back — a real move or a hole is not ours to delete", () => {
    const jump = [
      ...drive.slice(0, 50),
      ...moving(offset(BASE, 0, 30_000), drive[49].t, 45, 60, 300, 5),
    ];
    expect(filterJitter(asFixes(jump), [0], JITTER_PROFILES.road).dropped).toBe(0);
  });

  // A stale repeated fix is dropped only when it is also impossible — see
  // jitterFilter.frozen.test.ts (an exact repeat a walk can reach is a return).

  it("keeps identical repeated fixes while the time advances — a phone standing still briefly", () => {
    const walk = moving(BASE, T0, 0, 5, 300, 5);
    const paused = [
      ...walk.slice(0, 30),
      ...[1, 2, 3].map((k) => ({ ...walk[29], t: walk[29].t + k * 5000 })),
      ...walk.slice(30).map((f) => ({ ...f, t: f.t + 15_000 })),
    ];
    expect(filterJitter(asFixes(paused), [0], JITTER_PROFILES.foot).dropped).toBe(0);
  });
});

describe("jitter filter — coarse fixes", () => {
  const walk = moving(BASE, T0, 0, 5, 600, 10, 10);

  it("drops a cell-tower fix when a satellite fix lies within two minutes", () => {
    const coarse = [...walk];
    coarse[20] = { ...coarse[20], ...offset(coarse[20], 900, 0), accuracy: 1500 };
    const result = filterJitter(asFixes(coarse), [0], JITTER_PROFILES.foot);
    expect(result.dropped).toBe(1);
  });

  it("keeps a long run of coarse fixes with nothing better near — the only record of that stretch", () => {
    const tunnel = moving(BASE, T0, 0, 80, 1800, 60, 1200);
    const result = filterJitter(asFixes(tunnel), [0], JITTER_PROFILES.rail);
    expect(result.dropped).toBe(0);
  });
});

describe("jitter filter — real slow movement is kept", () => {
  const cases: Array<[string, JitterMode, SyntheticFix[], number]> = [
    ["a plane taxiing at 15 km/h", "flight", moving(BASE, T0, 120, 15, 600, 5), 2.5],
    [
      "a plane crawling to the holding point at 5 km/h",
      "flight",
      moving(BASE, T0, 120, 5, 600, 5),
      0.833,
    ],
    ["a car in traffic at 5 km/h", "road", moving(BASE, T0, 10, 5, 900, 5), 1.25],
    ["a hike uphill at 2 km/h", "foot", moving(BASE, T0, 200, 2, 1200, 10), 0.667],
  ];

  it.each(cases)("%s: no fix dropped, distance unchanged", (_label, mode, fixes, trueKm) => {
    const result = filterJitter(asFixes(fixes), [0], JITTER_PROFILES[mode]);
    expect(result.dropped).toBe(0);
    expect(Math.abs(measuredKm(fixes, mode) - trueKm) / trueKm).toBeLessThan(0.01);
  });

  it("a walk on a ferry deck while the ferry sails: every fix kept", () => {
    // The ferry makes 30 km/h north; the passenger walks fore and aft at
    // 4 km/h for a minute each way, a fix every 5 s, for 20 minutes.
    const rnd = noise(11);
    const fixes: SyntheticFix[] = Array.from({ length: 240 }, (_, i) => {
      const s = (i + 1) * 5;
      const deck = ((Math.floor(s / 60) % 2 === 0 ? s % 60 : 60 - (s % 60)) * 4) / 3.6;
      const p = offset(BASE, rnd() * 3, (s * 30) / 3.6 + deck);
      return { t: T0 + s * 1000, ...p, accuracy: 6 };
    });
    expect(filterJitter(asFixes(fixes), [0], JITTER_PROFILES.ship).dropped).toBe(0);
  });

  it("a walk from the stern of a moored ship over the gangway ashore: every fix kept", () => {
    const deck = moving(BASE, T0, 0, 4, 225, 5, 5);
    const ashore = moving(last(deck), last(deck).t, 90, 4, 300, 5, 5);
    const fixes = [...deck, ...ashore];
    expect(filterJitter(asFixes(fixes), [0], JITTER_PROFILES.ship).dropped).toBe(0);
  });

  it("pacing to and fro inside the stay radius of a moored ship is standing at map scale", () => {
    // 40 m of deck, end to end and back at 4 km/h for ten minutes. On the map
    // this is one place; the 670 m paced are not a distance travelled.
    const fixes: SyntheticFix[] = Array.from({ length: 120 }, (_, i) => {
      const s = (i + 1) * 5;
      const along = ((Math.floor(s / 36) % 2 === 0 ? s % 36 : 36 - (s % 36)) * 4) / 3.6;
      return { t: T0 + s * 1000, ...offset(BASE, 0, along), accuracy: 5 };
    });
    expect(filterJitter(asFixes(fixes), [0], JITTER_PROFILES.ship).fixes).toHaveLength(1);
  });
});

describe("jitter filter — what it does not touch", () => {
  it("leaves a recording without times alone and says it could not check", () => {
    const gate = standing(BASE, T0, 10, 10, 150);
    const untimed: ParsedTrack = { ...parsed(gate), times: undefined, accuracies: undefined };
    const filtered = filterParsedTrack(untimed, "flight");
    expect(filtered.points).toEqual(untimed.points);
    expect(filtered.jitterDropped).toBeNull();
    expect(ingestTrack(filtered)!.jitterDropped).toBeNull();
  });

  it("never compares across a recording's own segment break, and keeps every segment", () => {
    const a = moving(BASE, T0, 0, 50, 300, 10);
    const b = moving(offset(BASE, 20_000, 0), last(a).t + 1000, 0, 50, 300, 10);
    const result = filterJitter(asFixes([...a, ...b]), [0, a.length], JITTER_PROFILES.road);
    expect(result.dropped).toBe(0);
    expect(result.segmentStarts).toEqual([0, a.length]);
  });

  it("carries heights through, a stay taking the mean of its readings", () => {
    const gate = standing(BASE, T0, 10, 10, 50);
    const go = moving(BASE, last(gate).t, 90, 40, 120, 10);
    const all = [...gate, ...go];
    const track = { ...parsed(all), elevations: all.map((_, i) => (i < gate.length ? 100 : 120)) };
    const filtered = filterParsedTrack(track, "road");
    expect(filtered.elevations?.[0]).toBe(100);
    expect(filtered.elevations).toHaveLength(filtered.points.length);
  });
});

describe("tourJitterMode", () => {
  it("reads the activity first, then the leg mode, else assumes least", () => {
    expect(tourJitterMode({ mode: "road", activity: "hike" })).toBe("foot");
    expect(tourJitterMode({ mode: "ferry", activity: null })).toBe("ship");
    expect(tourJitterMode({ mode: "bike", activity: "mtb" })).toBe("bike");
    expect(tourJitterMode({ mode: "hovercraft", activity: null })).toBe("mixed");
  });
});
