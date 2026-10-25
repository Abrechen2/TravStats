import type { DawarichClient, DawarichPoint } from "../../../dawarich/dawarichClient";
import { readSpan, type DayHarvest } from "../dawarichRead";

/**
 * Reading a span for the Dawarich copy (TravTrack plan L6), without a
 * database: a whole window is grouped by UTC day in one pass — a dense day of
 * 50,000 fixes costs linear work, not a copy of the day per fix (Codex review
 * of L6).
 */

const DAY = Date.parse("2026-03-30T00:00:00Z");

function clientWith(points: DawarichPoint[]): DawarichClient {
  return {
    checkHealth: async () => ({ reachable: true, version: "1.9.2" }),
    getPoints: async () => ({ points, truncated: false, unusable: 0 }),
  };
}

const fix = (i: number, tMs: number): DawarichPoint => ({
  id: i,
  latitude: 37.5,
  longitude: 127 + i * 1e-6,
  timestampMs: tMs,
  altitude: null,
  accuracy: 5,
  velocity: null,
  trackId: null,
});

async function collect(client: DawarichClient, from: number, to: number) {
  const days: DayHarvest[] = [];
  for await (const d of readSpan({ client, beforeRequest: async () => undefined }, from, to)) {
    days.push(d);
  }
  return days;
}

describe("Dawarich copy — reading a span", () => {
  it("groups 50,000 fixes of one day in linear time", async () => {
    const points = Array.from({ length: 50_000 }, (_, i) => fix(i, DAY + i * 1000));
    const started = performance.now();
    const days = await collect(clientWith(points), DAY - 86_400_000, DAY + 2 * 86_400_000);
    const elapsed = performance.now() - started;
    expect(days.map((d) => [d.day, d.points.length])).toEqual([["2026-03-30", 50_000]]);
    expect(elapsed).toBeLessThan(500);
  });

  it("keeps each day's fixes in time order", async () => {
    const points = [fix(1, DAY + 5), fix(2, DAY + 86_400_000), fix(3, DAY + 9)];
    const days = await collect(clientWith(points), DAY, DAY + 2 * 86_400_000);
    expect(days.map((d) => d.points.map((p) => p.id))).toEqual([[1, 3], [2]]);
  });
});
