import { localDay } from "../../../shared/time/instant";
import { pointsByDevice, recordingDays, type StoredPoint } from "../segments";

/**
 * The trip recording's map read (`GET /trips/:id/recording`) lists the days
 * a recording covers, and with `?day=` keeps one of them. Both asked
 * `localDay` — an `Intl` reading — once per point: 2.3 s for 300 000 points
 * on every page view, eight times the jitter filter beside it (found in the
 * review of forgejo#319). The answer must stay exactly what `localDay` gives,
 * in the zones whose offsets and transitions are odd.
 */

const ZONES = [
  "Europe/Berlin",
  "America/St_Johns", // -03:30, DST
  "Asia/Kathmandu", // +05:45
  "Australia/Eucla", // +08:45
  "Pacific/Chatham", // +12:45 / +13:45
  "Australia/Lord_Howe", // a 30-minute DST shift
  "America/Santiago", // transitions at local midnight
  "Pacific/Kiritimati", // +14:00
  "America/Havana", // DST changes at 00:00 / 01:00 local
  "UTC",
];

/** A year at irregular steps, with every millisecond offset a phone might send. */
function yearOfPoints(stepMs: number): StoredPoint[] {
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2027, 0, 1);
  const points: StoredPoint[] = [];
  for (let t = start, k = 0; t < end; t += stepMs + (k % 7) * 997, k++) {
    points.push([t, 50, 8, null]);
  }
  return points;
}

/** Every twenty minutes of each day's 28 hours around UTC noon, where every zone's midnight lies. */
function aroundMidnights(): StoredPoint[] {
  const points: StoredPoint[] = [];
  for (let day = 0; day < 366; day += 1) {
    const noonUtc = Date.UTC(2026, 0, 1 + day, 12);
    // Local midnight lies within 14 h of UTC noon either way.
    for (let t = noonUtc - 14 * 3_600_000; t < noonUtc + 14 * 3_600_000; t += 1_200_000) {
      points.push([t, 50, 8, null], [t - 1, 50, 8, null]);
    }
  }
  return points;
}

describe("the days of a recording", () => {
  it.each(ZONES)("%s: the same day as localDay for every point", (zone) => {
    const points = [...yearOfPoints(17 * 60_000 + 13), ...aroundMidnights()];
    const expected = points.map((p) => localDay(new Date(p[0]), zone));
    expect(recordingDays(points, zone)).toEqual([...new Set(expected)].sort());
    // The `?day=` filter keeps exactly the points localDay puts on that day.
    for (const day of ["2026-03-08", "2026-03-29", "2026-04-05", "2026-09-06", "2026-10-25"]) {
      const kept = pointsByDevice([{ deviceId: "a", points }], zone, day)[0]?.points ?? [];
      const want = points.filter((_, i) => expected[i] === day).sort((a, b) => a[0] - b[0]);
      expect(kept).toEqual(want);
    }
  });

  it("answers for 300 000 points without reading the zone once per point", () => {
    const points = yearOfPoints(100_000).slice(0, 300_000);
    expect(points).toHaveLength(300_000);
    recordingDays(points.slice(0, 1000), "America/St_Johns"); // warm up
    const started = performance.now();
    const days = recordingDays(points, "America/St_Johns");
    const elapsedMs = performance.now() - started;
    expect(days.length).toBeGreaterThan(300);
    // Per point it took ~2.3 s; per offset span it is a few tens of ms.
    expect(elapsedMs).toBeLessThan(300);
  });
});
