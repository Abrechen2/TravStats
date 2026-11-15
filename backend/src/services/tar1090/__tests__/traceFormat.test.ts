import { joinAcrossDays } from "../receiverFetch";
import { parseTrace, pickLegInWindow } from "../traceFormat";
import { DAY_START_S, cruiseRows, traceFile } from "./traceFixtures";

describe("tar1090 trace format", () => {
  it("reads fixes into absolute times, metres and m/s", () => {
    const parsed = parseTrace(traceFile(cruiseRows(3600, 5)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [first, second] = parsed.legs[0].points;
    expect(first.t).toBe((DAY_START_S + 3600) * 1000);
    expect(first.alt).toBeUndefined(); // "ground"
    expect(second.alt).toBeCloseTo(35_000 * 0.3048, 1);
    expect(second.speed).toBeCloseTo(450 * 0.514444, 1);
    expect(parsed.registration).toBe("D-AIXA");
  });

  it("starts a new leg at the new-leg flag, and keeps legs apart", () => {
    const rows = [...cruiseRows(0, 3), ...cruiseRows(7200, 4)];
    const parsed = parseTrace(traceFile(rows));
    expect(parsed.ok && parsed.legs.map((l) => l.points.length)).toEqual([3, 4]);
  });

  it("drops stale positions instead of drawing them", () => {
    const rows = cruiseRows(0, 4);
    rows[2][6] = 1;
    const parsed = parseTrace(traceFile(rows));
    expect(parsed.ok && parsed.legs[0].points).toHaveLength(3);
  });

  it("refuses a body that is not a trace file, and a trace without fixes", () => {
    expect(parseTrace({ ac: [] })).toEqual({ ok: false, reason: "notATrace" });
    expect(parseTrace("<html>")).toEqual({ ok: false, reason: "notATrace" });
    expect(parseTrace(traceFile([]))).toEqual({ ok: false, reason: "noFixes" });
    expect(parseTrace(traceFile([["x", 1, 2]]))).toEqual({ ok: false, reason: "noFixes" });
  });

  it("picks the leg that overlaps the flight window most, or none", () => {
    const parsed = parseTrace(traceFile([...cruiseRows(0, 10), ...cruiseRows(36_000, 30)]));
    if (!parsed.ok) throw new Error("fixture");
    const ms = (s: number) => (DAY_START_S + s) * 1000;
    expect(pickLegInWindow(parsed.legs, ms(35_000), ms(40_000))?.points).toHaveLength(30);
    expect(pickLegInWindow(parsed.legs, ms(20_000), ms(30_000))).toBeNull();
  });

  it("joins a flight that crossed midnight UTC, but not two separate flights", () => {
    const day1 = parseTrace(traceFile(cruiseRows(86_400 - 600, 10)));
    const day2 = parseTrace(traceFile(cruiseRows(0, 10), { timestamp: DAY_START_S + 86_400 }));
    const far = parseTrace(
      traceFile(cruiseRows(0, 10), { timestamp: DAY_START_S + 86_400 + 4 * 3600 })
    );
    if (!day1.ok || !day2.ok || !far.ok) throw new Error("fixture");
    expect(joinAcrossDays([day1.legs, day2.legs])).toHaveLength(1);
    expect(joinAcrossDays([day1.legs, far.legs])).toHaveLength(2);
  });
});
