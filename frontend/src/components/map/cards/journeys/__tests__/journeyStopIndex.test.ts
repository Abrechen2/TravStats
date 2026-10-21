import { describe, expect, it } from "vitest";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { withJourneyCards, journeyStopPinned } from "../journeyLayerCards";
import { indexStops, journeysAtStop, endKey } from "../journeyStats";
import type { MapJourney } from "../journeyTypes";

/**
 * Codex review: every station dot asked every journey whether it touched it —
 * stations × journeys endpoint reads on each layer rebuild, millions on a busy
 * account, all on the main thread before the map answered. The stations are
 * now indexed once per rebuild.
 */

let reads = 0;
function journey(i: number): MapJourney {
  const dep = { name: `S${i}`, lat: 40 + i * 0.01, lon: 10, country: null };
  const arr = { name: `T${i}`, lat: 40 + i * 0.01, lon: 11, country: null };
  const j = {
    id: `j${i}`,
    domain: "rail",
    departureTime: null,
    status: "completed",
    distanceKm: null,
    operator: null,
    travelled: true,
    planned: false,
    facts: {},
  } as unknown as MapJourney;
  Object.defineProperty(j, "dep", { get: () => (reads++, dep), enumerable: true });
  Object.defineProperty(j, "arr", { get: () => (reads++, arr), enumerable: true });
  return j;
}

describe("station cards on a busy map", () => {
  it("reads each journey's ends a bounded number of times, not once per station", () => {
    const N = 400;
    const journeys = Array.from({ length: N }, (_, i) => journey(i));
    const stops = journeys.flatMap((_, i) => [
      { position: [10, 40 + i * 0.01] as [number, number] },
      { position: [11, 40 + i * 0.01] as [number, number] },
    ]);
    const layer = new ScatterplotLayer({ id: "all-rail-stations", data: stops }) as Layer;
    reads = 0;
    const [decorated] = withJourneyCards([layer], journeys, [1, 2, 3]);
    // Every dot still knows its journeys.
    const data = decorated.props.data as Array<{ journeyStop?: { travelled: number } }>;
    expect(data.every((d) => d.journeyStop?.travelled === 1)).toBe(true);
    // Linear: a few reads per journey. Station × journey was 2 · 800 · 400.
    expect(reads).toBeLessThan(20 * N);
  });

  it("the index answers what the scan answered, in the same order", () => {
    const journeys = [journey(1), journey(2), { ...journey(3), status: "cancelled" }];
    const loop = {
      ...journey(4),
      arr: { name: "S1", lat: 40.01, lon: 10, country: null },
    } as MapJourney;
    const all = [...journeys, loop];
    const index = indexStops(all);
    for (const key of [endKey({ lat: 40.01, lon: 10 }), endKey({ lat: 40.02, lon: 11 })]) {
      expect(index.get(key) ?? []).toEqual(journeysAtStop(all, key));
    }
    expect(journeyStopPinned(index, [10, 40.01], [1, 2, 3])).toEqual(
      journeyStopPinned(all, [10, 40.01], [1, 2, 3])
    );
  });
});
