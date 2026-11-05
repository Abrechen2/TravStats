import type { StoredPoint } from "../../tripRecording/segments";
import type { FoldContext, FoldPlace } from "../legs/fold";
import { deriveLegs } from "../legs/derive";
import type { StopPlaceRow } from "../legs/types";
import type { SafePointRow, SafeSpan } from "../readSafe";
import { insideWindow } from "../places/window";

/**
 * Folding (spec 2026-11-05-travtrack-fixed-places, S3): the pure core. Berlin
 * on Monday 2 November 2026 is UTC+1, so 08:00 local is 07:00Z.
 */

const MIN = 60_000;
const M = 111_195;
const BERLIN = { lat: 52.52, lon: 13.405 };
/** Monday 2026-11-02 00:00 in Berlin. */
const MON = Date.parse("2026-11-01T23:00:00Z");
const at = (day: number, hh: number, mm = 0) => MON + day * 86_400_000 + (hh * 60 + mm) * MIN;

type Fix = { t: number; dNorth?: number; dEast?: number; acc?: number };

function span(fixes: Fix[], circles: SafeSpan["circles"] = []): SafeSpan {
  const rows = new WeakMap<StoredPoint, SafePointRow>();
  const segment = fixes.map((f, i): StoredPoint => {
    const p: StoredPoint = [
      f.t,
      BERLIN.lat + (f.dNorth ?? 0) / M,
      BERLIN.lon + (f.dEast ?? 0) / (M * Math.cos((BERLIN.lat * Math.PI) / 180)),
      f.acc ?? 5,
    ];
    rows.set(p, {
      id: `p${i}`,
      t: new Date(f.t),
      lat: p[1],
      lon: p[2],
      accuracyM: 5,
      altitudeM: null,
      speedMps: 0,
      course: null,
      motion: "stationary",
      deviceId: "d",
      origin: "companion:d",
      purpose: "everyday",
      seq: BigInt(i),
    });
    return p;
  });
  return {
    segments: [segment],
    rowOf: (p: StoredPoint) => rows.get(p),
    circles,
    deleted: [],
    paused: [],
    next: null,
    cursor: null,
  } as SafeSpan;
}

/** A fix every 5 minutes from `from` to `to` (inclusive), wobbling +-60 m around the offset. */
const stay = (from: number, to: number, dNorth = 0, wobble = 60): Fix[] => {
  const out: Fix[] = [];
  for (let t = from, i = 0; t <= to; t += 5 * MIN, i += 1) {
    out.push({ t, dNorth: dNorth + (i % 2 === 0 ? wobble : -wobble) });
  }
  return out;
};

const work = (over: Partial<FoldPlace> = {}): FoldPlace => ({
  id: "w1",
  name: "Office",
  kind: "work",
  ...BERLIN,
  radiusM: 150,
  window: null,
  zone: "Europe/Berlin",
  ...over,
});
const ctx = (places: FoldPlace[], lodgings: FoldContext["lodgings"] = []): FoldContext => ({
  places,
  lodgings,
});
const run = (read: SafeSpan, fold: FoldContext, places?: StopPlaceRow[]) =>
  deriveLegs(read, { windows: [], overrides: [], stays: [], places, fold });

describe("deriveLegs — fixed places fold a run into one stop", () => {
  it("folds a wobbling stay inside the circle into ONE stop at the place's point, with its fix count", () => {
    const fixes = stay(at(0, 9), at(0, 12));
    const { stops } = run(span(fixes), ctx([work()]));
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      fromMs: at(0, 9),
      untilMs: at(0, 12),
      anchor: BERLIN,
      folded: { fixCount: fixes.length },
      place: { name: "Office", source: "fixed", placeId: "w1", ...BERLIN },
    });
  });

  it("does not fold a stay outside the circle: the stop keeps its own anchor and no fold", () => {
    const { stops } = run(span(stay(at(0, 9), at(0, 12), 400, 10)), ctx([work()]));
    expect(stops).toHaveLength(1);
    expect(stops[0].folded).toBeNull();
    expect(stops[0].place).toBeNull();
    expect(stops[0].anchor.lat).not.toBe(BERLIN.lat);
  });

  it("does not turn a pass-by shorter than a stop into a fold", () => {
    const { stops } = run(span(stay(at(0, 9), at(0, 9, 10))), ctx([work()]));
    expect(stops).toHaveLength(0);
  });

  it("makes the leg between two folded stops start and end at them", () => {
    const home = work({ id: "home", name: "Home", kind: "home", lat: BERLIN.lat + 3000 / M });
    const fixes = [
      ...stay(at(0, 7), at(0, 8), 3000),
      // 3 km in 30 minutes
      ...[1, 2, 3, 4, 5].map((k): Fix => ({ t: at(0, 8) + k * 5 * MIN, dNorth: 3000 - k * 500 })),
      ...stay(at(0, 8, 35), at(0, 12)),
    ];
    const { legs, stops } = run(span(fixes), ctx([home, work()]));
    expect(stops.map((s) => s.place?.name)).toEqual(["Home", "Office"]);
    expect(legs).toHaveLength(1);
    expect(legs[0].fromMs).toBeGreaterThanOrEqual(stops[0].untilMs);
    expect(legs[0].untilMs).toBeLessThanOrEqual(stops[1].fromMs);
  });

  it("leaves the raw points alone: the same segments go in and the derivation reads them only", () => {
    const read = span(stay(at(0, 9), at(0, 12)));
    const before = JSON.stringify(read.segments);
    run(read, ctx([work()]));
    expect(JSON.stringify(read.segments)).toBe(before);
  });
});

describe("deriveLegs — coarse fixes", () => {
  it("never fold a stay out of kilometre-wide readings, even when the stretch holds nothing finer", () => {
    const coarse = stay(at(0, 9), at(0, 12), 0, 10).map((f) => ({ ...f, acc: 1900 }));
    const { stops } = run(span(coarse), ctx([work()]));
    expect(stops.every((s) => s.folded === null)).toBe(true);
  });
});

describe("deriveLegs — a place's window", () => {
  const office = work({ window: { days: [1, 2, 3, 4, 5], from: "08:00", until: "17:00" } });

  it("folds only the part of a stay that lies inside the window; the rest stays an ordinary stop", () => {
    // 15:00-19:00 local on a Monday; the window ends at 17:00.
    const { stops } = run(span(stay(at(0, 15), at(0, 19), 0, 10)), ctx([office]));
    expect(stops).toHaveLength(2);
    expect(stops[0]).toMatchObject({ folded: { fixCount: expect.any(Number) } });
    expect(stops[0].untilMs).toBeLessThanOrEqual(at(0, 17));
    expect(stops[1].folded).toBeNull();
    expect(stops[1].fromMs).toBeGreaterThanOrEqual(at(0, 17));
  });

  it("folds nothing on a day the window does not list (Saturday)", () => {
    const { stops } = run(span(stay(at(5, 9), at(5, 12), 0, 10)), ctx([office]));
    expect(stops.every((s) => s.folded === null)).toBe(true);
  });

  it("reads the window in the PLACE's zone, not UTC: 08:30 Berlin (07:30Z) is inside", () => {
    const { stops } = run(span(stay(at(0, 8, 30), at(0, 10))), ctx([office]));
    expect(stops[0].folded).not.toBeNull();
    expect(insideWindow(at(0, 7, 59), "Europe/Berlin", office.window!)).toBe(false);
    expect(insideWindow(at(0, 8, 0), "Europe/Berlin", office.window!)).toBe(true);
    expect(insideWindow(at(0, 17, 0), "Europe/Berlin", office.window!)).toBe(false);
  });

  it("abstains when the place's zone is unknown: a windowed place without a zone folds nothing", () => {
    const { stops } = run(span(stay(at(0, 9), at(0, 12), 0, 10)), ctx([{ ...office, zone: null }]));
    expect(stops.every((s) => s.folded === null)).toBe(true);
  });

  it("holds a window across midnight: Friday 22:00-06:00 covers Saturday 03:00 but not Saturday 23:00", () => {
    const night = { days: [5], from: "22:00", until: "06:00" };
    expect(insideWindow(at(4, 23), "Europe/Berlin", night)).toBe(true); // Fri 23:00
    expect(insideWindow(at(5, 3), "Europe/Berlin", night)).toBe(true); // Sat 03:00
    expect(insideWindow(at(5, 6), "Europe/Berlin", night)).toBe(false); // Sat 06:00
    expect(insideWindow(at(5, 23), "Europe/Berlin", night)).toBe(false); // Sat 23:00
    expect(insideWindow(at(4, 3), "Europe/Berlin", night)).toBe(false); // Fri 03:00 (Thursday's night)
    // Sunday 02:00 belongs to Saturday's start: a window listing 6 and 7 wraps the week.
    expect(
      insideWindow(at(6, 2), "Europe/Berlin", { days: [6], from: "22:00", until: "06:00" })
    ).toBe(true);
    expect(
      insideWindow(at(0, 2), "Europe/Berlin", { days: [7], from: "22:00", until: "06:00" })
    ).toBe(true);
    const folded = run(span(stay(at(5, 1), at(5, 4))), ctx([work({ window: night })]));
    expect(folded.stops[0].folded).not.toBeNull();
  });
});

describe("deriveLegs — lodging", () => {
  const stayFold = {
    stayId: "stay-1",
    name: "Hotel Mitte",
    ...BERLIN,
    radiusM: 150,
    fromMs: at(0, 15),
    untilMs: at(2, 11),
  };

  it("folds the stay between check-in and check-out into one stop named after the hotel", () => {
    const { stops } = run(span(stay(at(0, 16), at(1, 7))), ctx([], [stayFold]));
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      anchor: BERLIN,
      folded: { fixCount: expect.any(Number) },
      place: { name: "Hotel Mitte", source: "lodging", lodgingStayId: "stay-1" },
    });
  });

  it("does not fold before check-in", () => {
    const { stops } = run(span(stay(at(0, 9), at(0, 13), 0, 10)), ctx([], [stayFold]));
    expect(stops.every((s) => s.folded === null)).toBe(true);
  });

  it("folds nothing when no lodging is passed in (setting off, or a house without coordinates)", () => {
    const { stops } = run(span(stay(at(0, 16), at(1, 7), 0, 10)), ctx([], []));
    expect(stops[0].folded).toBeNull();
  });
});

describe("deriveLegs — precedence", () => {
  const lodging = {
    stayId: "stay-1",
    name: "Hotel",
    ...BERLIN,
    radiusM: 500,
    fromMs: at(0, 0),
    untilMs: at(3, 0),
  };

  it("a fixed place beats a lodging on the same stop", () => {
    const { stops } = run(span(stay(at(0, 9), at(0, 12))), ctx([work()], [lodging]));
    expect(stops).toHaveLength(1);
    expect(stops[0].place).toMatchObject({ source: "fixed", name: "Office" });
  });

  it("the smaller of two overlapping circles wins", () => {
    const wide = work({ id: "wide", name: "Campus", radiusM: 800 });
    const narrow = work({ id: "narrow", name: "Desk", radiusM: 100 });
    const { stops } = run(span(stay(at(0, 9), at(0, 12), 20)), ctx([wide, narrow]));
    expect(stops).toHaveLength(1);
    expect(stops[0].place).toMatchObject({ placeId: "narrow", name: "Desk" });
    // A stay only the wide circle holds belongs to it.
    const away = run(span(stay(at(0, 9), at(0, 12), 400)), ctx([wide, narrow]));
    expect(away.stops[0].place).toMatchObject({ placeId: "wide" });
  });

  it("a name the owner accepted beats a fixed place, and the stop is still folded", () => {
    const accepted: StopPlaceRow[] = [
      {
        fromMs: at(0, 9),
        untilMs: at(0, 12),
        name: "My desk",
        lat: null,
        lon: null,
        updatedAtMs: 1,
      },
    ];
    const { stops } = run(span(stay(at(0, 9), at(0, 12))), ctx([work()]), accepted);
    expect(stops[0].place).toMatchObject({ source: "accepted", name: "My desk" });
    expect(stops[0].folded).not.toBeNull();
    expect(stops[0].anchor).toEqual(BERLIN);
  });
});

describe("deriveLegs — privacy zones win", () => {
  it("a fixed place centred inside a privacy zone folds nothing", () => {
    const zone = { lat: BERLIN.lat, lon: BERLIN.lon, radiusM: 300 };
    const { stops } = run(span(stay(at(0, 9), at(0, 12), 600, 10), [zone]), ctx([work()]));
    expect(stops.every((s) => s.folded === null)).toBe(true);
    expect(stops.every((s) => s.place === null)).toBe(true);
  });
});
