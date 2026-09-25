import { resolveRecordedLegs, type CruiseTrackCoverageRow } from "../recordedLegs";

function meridian(fromLat: number, toLat: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dir = toLat >= fromLat ? 1 : -1;
  const n = Math.round(Math.abs(toLat - fromLat) / 0.05);
  for (let i = 0; i <= n; i++) out.push([5, +(fromLat + dir * i * 0.05).toFixed(6)]);
  return out;
}

function row(
  id: string,
  geometry: Array<[number, number]>,
  segmentStarts: number[],
  startedAt = "2026-06-01T00:00:00Z"
): CruiseTrackCoverageRow {
  return { id, startedAt: new Date(startedAt), geometry, segmentStarts, cumulativeKm: null };
}

const A = { lat: 54, lon: 5 };
const B = { lat: 56, lon: 5 };
const C = { lat: 58, lon: 5 };

describe("resolveRecordedLegs", () => {
  it("gives each leg the complete recording over one with holes, whatever their order", () => {
    const first = meridian(54, 55);
    const gappy = row(
      "gappy",
      [...first, ...meridian(55.27, 56)],
      [0, first.length],
      "2026-05-01T00:00:00Z"
    );
    const whole = row("whole", meridian(54, 56), [0], "2026-06-01T00:00:00Z");
    const { recorded, verdicts } = resolveRecordedLegs([A, B], [whole, gappy]);
    expect(recorded[0]?.trackId).toBe("whole");
    expect(verdicts[0]).toEqual({ trackId: "whole", status: "covered", reason: "complete" });
  });

  it("keeps the earlier recording on a tie", () => {
    const early = row("early", meridian(54, 56), [0], "2026-05-01T00:00:00Z");
    const later = row("later", meridian(54, 56), [0], "2026-06-01T00:00:00Z");
    expect(resolveRecordedLegs([A, B], [later, early]).recorded[0]?.trackId).toBe("early");
  });

  it("explains an uncovered leg with the most useful reason and says nothing without recordings", () => {
    const partial = row("partial", meridian(56, 58), [0]);
    const { recorded, verdicts } = resolveRecordedLegs([A, B, C], [partial]);
    expect(recorded).toEqual([null, expect.objectContaining({ trackId: "partial" })]);
    expect(verdicts[0]).toEqual({ trackId: "partial", status: "notCovered", reason: "missesFrom" });
    expect(resolveRecordedLegs([A, B, C], []).verdicts).toEqual([null, null]);
  });

  it("reads an unreadable geometry column as covering nothing", () => {
    const broken = row("broken", [] as Array<[number, number]>, [0]);
    const garbage = { ...broken, geometry: ["a", "b"] };
    expect(resolveRecordedLegs([A, B], [garbage]).recorded).toEqual([null]);
  });
});
